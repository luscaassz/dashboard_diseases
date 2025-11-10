#!/usr/bin/env python3
"""
build_df_base_from_monthly.py

Cria arquivos df_base_<TX>.csv a partir dos arquivos *_monthly_long.csv.

Entrada (padrão): data/monthly/*.csv
Formato esperado de cada csv: cod_mun,nome_mun,date,value
 - date no formato ISO (YYYY-MM-01 ou YYYY-MM-DD)
 - cod_mun pode ser numérico ou string (será tratado como string)

Saída:
 - <output_dir>/df_base_<TXname>.csv  (uma para cada TX_*.csv encontrado)
   Colunas: date,cod_mun,nome_mun,<regressors...>,target,<outras_TX...>

Uso:
  python build_df_base_from_monthly.py --input_dir data/monthly --output_dir data/for_model
"""
import argparse
from pathlib import Path
import pandas as pd
import numpy as np
import re
from typing import List

pd.options.mode.chained_assignment = None

def read_monthly_file(p: Path):
    df = pd.read_csv(p, dtype={"cod_mun": str}, parse_dates=["date"], dayfirst=False)
    # normalize column names
    df.columns = [c.strip() for c in df.columns]
    expected = {"cod_mun", "nome_mun", "date", "value"}
    if not expected.issubset(set(df.columns)):
        raise ValueError(f"Arquivo {p.name} não tem colunas esperadas. Encontrado: {df.columns.tolist()}")
    # ensure cod_mun is string (no float)
    df["cod_mun"] = df["cod_mun"].astype(str).str.strip()
    # ensure date is monthly-first-of-month (normalize)
    df["date"] = pd.to_datetime(df["date"], errors="coerce")
    # set day to 1 to unify (if day present)
    df["date"] = df["date"].dt.to_period("M").dt.to_timestamp()
    # numeric conversion value
    df["value"] = pd.to_numeric(df["value"], errors="coerce")
    return df[["cod_mun", "nome_mun", "date", "value"]]

def slug_from_filename(p: Path):
    s = p.stem
    # remove suffixes like _monthly_long if present
    s = re.sub(r"_monthly_long$", "", s)
    return s

def pivot_all_files(files: List[Path]):
    """
    Read all monthly files and return dict of DataFrames keyed by slug.
    Each df in the dict has columns: cod_mun,nome_mun,date,value (normalized)
    """
    d = {}
    for p in files:
        slug = slug_from_filename(p)
        df = read_monthly_file(p)
        d[slug] = df
    return d

def build_wide_for_all(dfs_by_slug: dict, min_date=None, max_date=None, freq="MS"):
    """
    Build a single wide DataFrame with columns:
    ['date','cod_mun','nome_mun', '<slug1>', '<slug2>', ...]
    Return: DataFrame (long-ish wide: one row per date+cod_mun)
    Strategy:
      - get full set of cod_mun across all slug dfs
      - for each cod_mun, build a monthly index from global min->max (or per-mun min->max),
        then merge each slug's series (reindexed monthly) into a single DF for that cod_mun.
      - concatenate all cod_mun dfs.
    """
    # collect unique cod_mun
    all_muns = set()
    for slug, df in dfs_by_slug.items():
        all_muns.update(df["cod_mun"].unique())
    all_muns = sorted(all_muns)

    # global min/max if provided else compute from data
    if min_date is None:
        min_date = min(df["date"].min() for df in dfs_by_slug.values())
    if max_date is None:
        max_date = max(df["date"].max() for df in dfs_by_slug.values())

    rows = []
    total = len(all_muns)
    for i, mun in enumerate(all_muns, 1):
        # build per-mun DF
        # try get name from any source
        name = None
        pieces = []
        for slug, df in dfs_by_slug.items():
            sub = df[df["cod_mun"] == mun][["date","value","nome_mun"]].copy()
            if not sub.empty:
                if name is None:
                    # pick first non-null name
                    val = sub["nome_mun"].dropna()
                    if not val.empty:
                        name = str(val.iloc[0])
                sub = sub.set_index("date")["value"].rename(slug)
                pieces.append(sub)
        if not pieces:
            # no data for this municipality in any file -> skip
            continue
        # create index from min_date to max_date monthly
        idx = pd.date_range(start=min_date, end=max_date, freq=freq)
        mun_df = pd.DataFrame(index=idx)
        for s in pieces:
            mun_df = mun_df.join(s, how="left")
        # set cod_mun and nome_mun
        mun_df = mun_df.reset_index().rename(columns={"index":"date"})
        mun_df["cod_mun"] = mun
        mun_df["nome_mun"] = name if name is not None else ""
        rows.append(mun_df)
    if not rows:
        return pd.DataFrame()
    big = pd.concat(rows, ignore_index=True, sort=False)
    # reorder columns: date, cod_mun, nome_mun, <others>
    other_cols = [c for c in big.columns if c not in ("date","cod_mun","nome_mun")]
    ordered = ["date","cod_mun","nome_mun"] + other_cols
    big = big[ordered]
    return big

def fill_and_clean_per_mun(df_wide: pd.DataFrame, fill_method="interpolate", min_periods=24):
    """
    For each municipality, fill numeric cols using chosen method:
      - interpolate: temporal interpolation (method='time') + ffill + bfill
      - ffill: forward fill then bfill
      - bfill: backward fill then ffill
      - drop: drop rows with NA
    Also drop municipalities with fewer than min_periods non-NA target (if target present)
    """
    numeric_cols = [c for c in df_wide.columns if c not in ("date","cod_mun","nome_mun")]
    out_rows = []
    grouped = df_wide.groupby("cod_mun", sort=False)
    for cod, g in grouped:
        g = g.sort_values("date").reset_index(drop=True).copy()
        # numeric conversion (again)
        for c in numeric_cols:
            g[c] = pd.to_numeric(g[c], errors="coerce")
        if fill_method == "interpolate":
            # use time interpolation (requires datetime index)
            g2 = g.set_index("date")
            g2[numeric_cols] = g2[numeric_cols].interpolate(method="time", limit_direction="both")
            g2[numeric_cols] = g2[numeric_cols].ffill().bfill()
            g = g2.reset_index()
        elif fill_method == "ffill":
            g[numeric_cols] = g[numeric_cols].ffill().bfill()
        elif fill_method == "bfill":
            g[numeric_cols] = g[numeric_cols].bfill().ffill()
        elif fill_method == "drop":
            g = g.dropna(subset=numeric_cols, how="any")
        # optional: drop mun if not enough non-null points for target (handled later)
        out_rows.append(g)
    if not out_rows:
        return pd.DataFrame()
    return pd.concat(out_rows, ignore_index=True, sort=False)

def build_df_base_from_monthly(
    input_dir: Path,
    output_dir: Path,
    fill_method: str = "interpolate",
    min_periods: int = 24,
    force_overwrite: bool = False
):
    input_dir = Path(input_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    files = sorted(input_dir.glob("*.csv"))
    if not files:
        raise FileNotFoundError(f"Nenhum CSV encontrado em {input_dir}")

    # identify monthly_long files and read
    dfs_by_slug = {}
    for p in files:
        slug = slug_from_filename(p)
        # read only files with expected columns
        try:
            df = read_monthly_file(p)
        except Exception as e:
            print(f"Pulando {p.name}: {e}")
            continue
        dfs_by_slug[slug] = df

    # partition TX_ (doenças) vs regressors
    tx_keys = [k for k in dfs_by_slug.keys() if k.upper().startswith("TX_")]
    reg_keys = [k for k in dfs_by_slug.keys() if k not in tx_keys]

    print(f"Encontradas {len(tx_keys)} séries TX (doenças): {tx_keys}")
    print(f"Encontradas {len(reg_keys)} regressoras/exógenas: {reg_keys}")

    if not tx_keys:
        raise RuntimeError("Nenhuma série TX_ encontrada — nada para gerar como df_base alvo.")

    # build wide global
    wide = build_wide_for_all(dfs_by_slug)
    if wide.empty:
        raise RuntimeError("Wide DataFrame vazio — verifique os arquivos de entrada.")

    print("Montado wide DataFrame com shape:", wide.shape)

    # fill & clean per municipality
    cleaned = fill_and_clean_per_mun(wide, fill_method=fill_method, min_periods=min_periods)
    print("Após preenchimento, shape:", cleaned.shape)

    # for each TX produce df_base
    for tx in tx_keys:
        out_file = output_dir / f"df_base_{tx}.csv"
        if out_file.exists() and not force_overwrite:
            print(f"Arquivo {out_file} já existe — use --force para sobrescrever. Pulando.")
            continue
        # prepare dataset: target column = tx
        dfb = cleaned.copy()
        if tx not in dfb.columns:
            print(f"Atenção: {tx} não presente nas colunas finais. Pulando.")
            continue
        # create target column named 'target' and keep other TX columns as well
        dfb = dfb.rename(columns={tx: "target"})
        # re-order: date,cod_mun,nome_mun,<regressors>,target,<other tx columns>
        all_cols = list(dfb.columns)
        # regressors are reg_keys (if present) and any other non-TX columns
        tx_cols = [c for c in all_cols if str(c).upper().startswith("TX_") and c != tx]
        extra_cols = [c for c in all_cols if c not in ("date","cod_mun","nome_mun","target") + tuple(tx_cols) and c not in tx_cols]
        # order regressors = extra_cols
        ordered = ["date","cod_mun","nome_mun"] + extra_cols + ["target"] + tx_cols
        ordered = [c for c in ordered if c in dfb.columns]
        dfb = dfb[ordered]
        # ensure date is ISO string YYYY-MM-DD
        dfb["date"] = pd.to_datetime(dfb["date"], errors="coerce").dt.strftime("%Y-%m-%d")
        dfb.to_csv(out_file, index=False)
        print(f"Salvo {out_file} (shape={dfb.shape})")

    print("Concluído.")

def parse_args():
    p = argparse.ArgumentParser(description="Build df_base from monthly_long CSVs")
    p.add_argument("--input_dir", required=True, help="Pasta com arquivos *_monthly_long.csv (ex: data/monthly)")
    p.add_argument("--output_dir", required=True, help="Pasta de saída (ex: data/for_model)")
    p.add_argument("--fill_method", choices=("interpolate","ffill","bfill","drop"), default="interpolate",
                   help="Método para preencher lacunas")
    p.add_argument("--min_periods", type=int, default=24, help="Mínimo de períodos observados por município")
    p.add_argument("--force", action="store_true", help="Sobrescrever arquivos existentes")
    return p.parse_args()

def main():
    args = parse_args()
    build_df_base_from_monthly(args.input_dir, args.output_dir,
                               fill_method=args.fill_method, min_periods=args.min_periods,
                               force_overwrite=args.force)

if __name__ == "__main__":
    main()
