#!/usr/bin/env python3
"""
predict_xgb_single_city.py

Pipeline completo para treinar e testar XGBoost para uma doença em um município (ex: São Paulo),
com novas features temporais (lags, diffs, rolling, timestep) para melhorar a performance.

Exemplo:
python predict_xgb_single_city_v3.py \
    --file data/for_model/df_base_TX_hanseniase_00_23.csv \
    --disease TX_hanseniase_00_23 \
    --cod 3550308
"""
import argparse
import os
from pathlib import Path
import json
import joblib
import numpy as np
import pandas as pd
from datetime import datetime
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import xgboost as xgb
import matplotlib.pyplot as plt
import warnings
warnings.filterwarnings("ignore", category=FutureWarning)

# ---------------------------
# Helpers
# ---------------------------
def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def parse_args():
    p = argparse.ArgumentParser(description="Treina e testa XGBoost para 1 doença em 1 município (v3 com features temporais)")
    p.add_argument('--file', required=True, help='CSV de entrada (df_base) com coluna "date","cod_mun","target",... ')
    p.add_argument('--disease', required=True, help='nome do dataset / doença (apenas para nomes de pastas/saída). Ex: TX_hanseniase_00_23')
    p.add_argument('--cod', required=True, help='código do município (cod_mun) - ex: 3550308 para São Paulo')
    p.add_argument('--outdir', default='results/xgboost_single', help='pasta de saída')
    p.add_argument('--sequence_length', type=int, default=12, help='número de passos históricos')
    p.add_argument('--forecast_horizon', type=int, default=1, help='horizonte de previsão em passos')
    p.add_argument('--test_size', type=int, default=12, help='tamanho do teste (em períodos)')
    p.add_argument('--val_size', type=int, default=12, help='tamanho da validação (em períodos)')
    p.add_argument('--seed', type=int, default=42, help='seed aleatória')
    return p.parse_args()

# ---------------------------
# Preprocessing + sequences
# ---------------------------
def load_and_filter(filepath, cod_mun):
    df = pd.read_csv(filepath)
    df.columns = [c.strip() for c in df.columns]
    if 'date' in df.columns:
        df['date'] = pd.to_datetime(df['date'])
    elif 'ds' in df.columns:
        df['date'] = pd.to_datetime(df['ds'])
    else:
        raise ValueError("Arquivo não contém coluna 'date' nem 'ds'.")
    df = df[df['cod_mun'].astype(str) == str(cod_mun)].copy()
    df = df.sort_values('date').reset_index(drop=True)
    return df

def clean_fill(df, target_col):
    df = df.copy()
    df = df.ffill().bfill()
    df = df.dropna(subset=[target_col])
    df = df.dropna(axis=0, how='any')
    return df

def create_sequences_from_df(df, feature_cols, target_col, seq_len, horizon=1, target_mode='sum'):
    arr = df[feature_cols].values
    dates = df['date'].values
    n = arr.shape[0]
    n_features = arr.shape[1]
    X_list, y_list, y_dates = [], [], []
    for i in range(n - seq_len - horizon + 1):
        X_window = arr[i:i+seq_len]
        if target_mode == 'sum':
            y_value = arr[i+seq_len:i+seq_len+horizon, feature_cols.index(target_col)].sum()
        else:
            y_value = arr[i+seq_len+horizon-1, feature_cols.index(target_col)]
        X_list.append(X_window)
        y_list.append(y_value)
        y_dates.append(dates[i+seq_len:i+seq_len+horizon][-1])
    X = np.array(X_list)
    y = np.array(y_list)
    return X, y, np.array(y_dates)

def train_val_test_split_by_time(X, y, dates, test_size, val_size):
    n = X.shape[0]
    if test_size + val_size >= n:
        raise ValueError(f"Sequência insuficiente para os tamanhos solicitados (n={n}, test+val={test_size+val_size}).")
    train_end = n - (test_size + val_size)
    val_end = n - test_size
    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    X_test, y_test = X[val_end:], y[val_end:]
    dates_test = dates[val_end:]
    return X_train, y_train, X_val, y_val, X_test, y_test, dates_test

# ---------------------------
# Main pipeline
# ---------------------------
def main():
    args = parse_args()
    np.random.seed(args.seed)

    # Paths
    infile = Path(args.file)
    outdir = Path(args.outdir) / args.disease / str(args.cod)
    ensure_dir(outdir)
    model_outpath = outdir / "xgboost_model.json"
    scaler_outpath = outdir / "scaler.pkl"
    preds_outpath = outdir / f"{args.cod}_xgb_preds.csv"
    metrics_outpath = outdir / f"{args.cod}_xgb_metrics.json"
    fig_outpath = outdir / f"{args.cod}_xgb_preds.png"

    print("Carregando e filtrando dados...")
    df = load_and_filter(str(infile), args.cod)
    df = df[df['date'] <= '2022-12-31'].copy()
    if df.shape[0] == 0:
        raise ValueError("Nenhum dado disponível até 2022 para este município.")

    print(f"Usando {len(df)} registros até {df['date'].max().date()} para treino/teste.")

    # 🔹 NOVAS FEATURES TEMPORAIS
    df['timestep'] = np.arange(len(df))
    df['timestep2'] = df['timestep']**2
    df['target_roll3'] = df['target'].rolling(window=3).mean()
    # Lags 1-12
    for lag in range(1, 13):
        df[f'target_lag{lag}'] = df['target'].shift(lag)
    df['target_diff'] = df['target'].diff()
    df['target_pct_change'] = df['target'].pct_change()

    target_col = 'target'  # ainda usamos target original
    df = clean_fill(df, target_col)

    # Colunas de features
    ignore_cols = {'date', 'cod_mun', 'nome_mun'}
    feature_cols = [c for c in df.columns if c not in ignore_cols and c != target_col]

    print(f"Features usadas (count={len(feature_cols)}): {feature_cols}")

    # Criar sequências
    print("Criando sequências (janelas)...")
    X, y, y_dates = create_sequences_from_df(df, feature_cols + [target_col], target_col, args.sequence_length, args.forecast_horizon, target_mode='sum')
    print(f"Total de janelas: {X.shape[0]}, cada janela shape={X.shape[1:]}")

    # Split
    X_train, y_train, X_val, y_val, X_test, y_test, dates_test = train_val_test_split_by_time(X, y, y_dates, args.test_size, args.val_size)
    print(f"Split -> train: {X_train.shape[0]}, val: {X_val.shape[0]}, test: {X_test.shape[0]}")

    # Escalar features (apenas train)
    n_features = X_train.shape[2]
    scaler = StandardScaler()
    scaler.fit(X_train.reshape(-1, n_features))

    def scale_X(X_arr):
        ns, sl, nf = X_arr.shape
        return scaler.transform(X_arr.reshape(-1, nf)).reshape(ns, sl, nf)

    X_train_s = scale_X(X_train)
    X_val_s = scale_X(X_val)
    X_test_s = scale_X(X_test)

    # Flatten para XGBoost
    X_train_flat = X_train_s.reshape(X_train_s.shape[0], -1)
    X_val_flat = X_val_s.reshape(X_val_s.shape[0], -1)
    X_test_flat = X_test_s.reshape(X_test_s.shape[0], -1)

    # Treinar XGBoost
    print("Treinando XGBoost...")
    model = xgb.XGBRegressor(
        n_estimators=2000,
        learning_rate=0.03,
        max_depth=8,
        subsample=0.8,
        colsample_bytree=0.8,
        reg_lambda=1.0,
        reg_alpha=0.3,
        objective='reg:squarederror',
        random_state=args.seed,
        n_jobs=4
    )

    eval_set = [(X_train_flat, y_train), (X_val_flat, y_val)]
    model.fit(X_train_flat, y_train,
              eval_set=eval_set,
              early_stopping_rounds=50,
              eval_metric='rmse',
              verbose=False)

    print(f"Melhor n_estimators: {model.best_iteration if hasattr(model,'best_iteration') else 'n/a'}")

    # Previsão
    print("Prevendo (test)...")
    y_pred = model.predict(X_test_flat)

    # Métricas
    mae = mean_absolute_error(y_test, y_pred)
    rmse = mean_squared_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)
    metrics = {'mae': float(mae), 'rmse': float(rmse), 'r2': float(r2),
               'n_train': int(X_train_flat.shape[0]), 'n_val': int(X_val_flat.shape[0]), 'n_test': int(X_test_flat.shape[0])}
    print("Métricas (test):", metrics)

    # Salvar resultados
    model.save_model(str(model_outpath))
    joblib.dump(scaler, str(scaler_outpath))
    df_preds = pd.DataFrame({'date': pd.to_datetime(dates_test), 'y_true': y_test, 'y_pred': y_pred})
    df_preds.to_csv(str(preds_outpath), index=False)
    with open(str(metrics_outpath), 'w', encoding='utf-8') as fh:
        json.dump(metrics, fh, ensure_ascii=False, indent=2)

    # Plot
    plt.figure(figsize=(12,6))
    plt.plot(pd.to_datetime(dates_test), y_test, marker='o', linestyle='-', label='Actual')
    plt.plot(pd.to_datetime(dates_test), y_pred, marker='o', linestyle='--', label='XGBoost Forecast')
    plt.xlabel('Date')
    plt.ylabel('Target')
    plt.title(f'Forecast XGBoost - {args.disease} - mun {args.cod}')
    plt.legend()
    plt.grid(alpha=0.3)
    plt.tight_layout()
    plt.savefig(str(fig_outpath), dpi=150)
    plt.close()

    print(f"Concluído. Saídas em: {outdir}")

if __name__ == "__main__":
    main()
