#!/usr/bin/env python3
"""
run_batch_xgboost.py

Pipeline de Machine Learning em Lote para Séries Temporais (XGBoost).
Funcionalidades:
1. Varre uma pasta de entrada (--input_dir) buscando CSVs (df_base_*.csv).
2. Para cada arquivo (Doença), itera por TODOS os municípios disponíveis.
3. Aplica engenharia de features temporais (Lags, Rolling, Diffs).
4. Treina XGBoost, faz previsões e calcula métricas.
5. Gera 7 visualizações detalhadas para cada município.
6. Salva um resumo geral (summary.csv) com a performance de todos os modelos.

Exemplo de uso:
    python run_batch_xgboost.py --input_dir data/for_model --outdir results/batch_v1
"""

import argparse
import os
import glob
import json
import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import seaborn as sns
import xgboost as xgb
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from tqdm import tqdm
import warnings

# Configurações globais
warnings.filterwarnings("ignore")
sns.set_style("whitegrid")

# ---------------------------
# 1. Helpers & Plotting
# ---------------------------

def ensure_dir(path):
    Path(path).mkdir(parents=True, exist_ok=True)

def generate_plots(df_res, out_folder, cod_mun, disease_name, test_start_date=None):
    """
    Gera os 7 gráficos com a série completa.
    test_start_date: Data de corte para desenhar a linha vertical separando treino de teste.
    """
    # Preparar dados
    dates = df_res['date']
    y_true = df_res['y_true'].values
    y_pred = df_res['y_pred'].values
    errors = y_pred - y_true
    
    prefix = f"{disease_name}_{cod_mun}"
    
    # Helper para desenhar a linha divisória (Início do Teste)
    def plot_separator():
        if test_start_date is not None:
            plt.axvline(test_start_date, color='gray', linestyle='--', alpha=0.5, label='Início Teste')

    # 1. Forecast vs Actual
    plt.figure(figsize=(12, 6))
    plt.plot(dates, y_true, label='Histórico Real', marker='o', color='black', alpha=0.6, markersize=3)
    plt.plot(dates, y_pred, label='Modelo XGBoost', linestyle='-', color='dodgerblue', alpha=0.8, linewidth=1.5)
    plot_separator()
    plt.title(f"Série Histórica e Previsão - {disease_name} (Mun: {cod_mun})")
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_folder / f"{prefix}_1_forecast_vs_actual.png")
    plt.close()

    # 2. Forecast Error (Valores absolutos)
    plt.figure(figsize=(12, 6))
    plt.plot(dates, np.abs(errors), color='salmon', linewidth=1)
    plot_separator()
    plt.title(f"Erro Absoluto ao Longo do Tempo - {disease_name} ({cod_mun})")
    plt.ylabel("Erro Absoluto (|Prev - Real|)")
    plt.tight_layout()
    plt.savefig(out_folder / f"{prefix}_2_forecast_error.png")
    plt.close()

    # 3. Distribution of Errors
    plt.figure(figsize=(10, 6))
    sns.histplot(errors, kde=True, bins=30, color='crimson')
    plt.title(f'Distribuição dos Erros (Série Completa) - {disease_name} ({cod_mun})')
    plt.xlabel('Erro (Previsto - Real)')
    plt.ylabel('Frequência')
    plt.tight_layout()
    plt.savefig(out_folder / f"{prefix}_3_error_dist.png")
    plt.close()

    # 4. Scatter Plot: Actual vs Predicted
    plt.figure(figsize=(8, 8))
    plt.scatter(y_true, y_pred, alpha=0.4, c='purple', s=15)
    # Linha de identidade (Perfeito)
    if len(y_true) > 0:
        min_val = min(y_true.min(), y_pred.min())
        max_val = max(y_true.max(), y_pred.max())
        plt.plot([min_val, max_val], [min_val, max_val], 'k--', lw=2, label='Ideal')
    plt.title(f'Dispersão Real vs Previsto - {disease_name} ({cod_mun})')
    plt.xlabel('Real')
    plt.ylabel('Previsto')
    plt.legend()
    plt.tight_layout()
    plt.savefig(out_folder / f"{prefix}_4_scatter.png")
    plt.close()

    # 5. Residuals Over Time
    plt.figure(figsize=(12, 6))
    plt.plot(dates, errors, marker='.', linestyle='-', color='orange', linewidth=0.8)
    plt.axhline(0, color='black', linestyle='--')
    plot_separator()
    plt.title(f'Resíduos ao Longo do Tempo - {disease_name} ({cod_mun})')
    plt.ylabel('Resíduo (Previsto - Real)')
    plt.tight_layout()
    plt.savefig(out_folder / f"{prefix}_5_residuals_time.png")
    plt.close()

    # 6. Rolling Mean of Errors
    window = 6 # Janela um pouco maior para visualizar tendência na série longa
    rolling_error = pd.Series(errors).rolling(window=window).mean()
    plt.figure(figsize=(12, 6))
    plt.plot(dates, rolling_error, color='purple', linewidth=2)
    plt.axhline(0, color='gray', linestyle='--', alpha=0.5)
    plot_separator()
    plt.title(f'Média Móvel dos Erros (Janela={window}) - {disease_name} ({cod_mun})')
    plt.tight_layout()
    plt.savefig(out_folder / f"{prefix}_6_rolling_error.png")
    plt.close()

    # 7. Cumulative Error
    cumulative_error = np.cumsum(errors)
    plt.figure(figsize=(12, 6))
    plt.plot(dates, cumulative_error, color='teal', linewidth=2)
    plot_separator()
    plt.title(f'Erro Acumulado (Viés) - {disease_name} ({cod_mun})')
    plt.ylabel('Soma Cumulativa dos Erros')
    plt.axhline(0, color='black', linestyle='--')
    plt.tight_layout()
    plt.savefig(out_folder / f"{prefix}_7_cumulative_error.png")
    plt.close()


# ---------------------------
# 2. Data Processing Logic
# ---------------------------

def create_features_and_clean(df, target_col='target'):
    """Aplica engenharia de features (Lags, Rolling, Diffs)."""
    df = df.copy()
    df = df.sort_values('date').reset_index(drop=True)
    
    # Feature 1: Tendência temporal simples
    df['timestep'] = np.arange(len(df))
    
    # Feature 2: Sazonalidade (Seno/Cosseno do mês)
    df['month_sin'] = np.sin(2 * np.pi * df['date'].dt.month / 12)
    df['month_cos'] = np.cos(2 * np.pi * df['date'].dt.month / 12)

    # Feature 3: Médias Móveis (Tendência recente)
    df['target_roll3'] = df[target_col].rolling(window=3).mean()
    
    # Feature 4: Lags (Histórico) - Até 12 meses atrás
    for lag in range(1, 13):
        df[f'target_lag{lag}'] = df[target_col].shift(lag)
        
    # Feature 5: Diferenciação (Velocidade de mudança)
    df['target_diff1'] = df[target_col].diff(1) 
    
    # Limpeza (Drop NaNs gerados pelos lags)
    df = df.dropna().reset_index(drop=True)
    
    return df

def create_sequences(df, feature_cols, target_col, seq_len=12, horizon=1):
    """Transforma DF em matrizes X, y para treino."""
    data = df[feature_cols + [target_col]].values 
    dates = df['date'].values
    
    target_idx = -1 
    
    X, y, y_dates = [], [], []
    
    num_samples = len(df) - seq_len - horizon + 1
    if num_samples < 1:
        return np.array([]), np.array([]), np.array([])

    for i in range(num_samples):
        X_window = data[i : i+seq_len, :-1] 
        y_val = np.sum(data[i+seq_len : i+seq_len+horizon, target_idx])
        y_date = dates[i+seq_len+horizon-1]
        
        X.append(X_window)
        y.append(y_val)
        y_dates.append(y_date)
        
    return np.array(X), np.array(y), np.array(y_dates)

def process_single_city(df_city, disease_name, cod_mun, args):
    """Pipeline completo: Prep -> Train -> Predict FULL -> Plot -> JSON."""
    
    # 1. Filtro Temporal Rígido
    df_city = df_city[df_city['date'] <= '2022-12-31'].copy()
    
    # Checagem mínima de dados
    if len(df_city) < 36: 
        return None 

    # 2. Feature Engineering
    df_feat = create_features_and_clean(df_city, target_col='target')
    
    ignore = {'date', 'cod_mun', 'nome_mun', 'target'}
    feature_cols = [c for c in df_feat.columns if c not in ignore]
    
    # 3. Criar Sequências
    # Usamos seq_len=1 pois os lags já capturam histórico
    X, y, dates = create_sequences(df_feat, feature_cols, 'target', seq_len=1, horizon=args.forecast_horizon)
    
    if len(y) < (args.test_size + args.val_size + 6):
        return None

    # 4. Split Temporal
    test_size = args.test_size
    val_size = args.val_size
    n = len(y)
    train_end = n - test_size - val_size
    val_end = n - test_size
    
    # Separação para Treino
    X_train, y_train = X[:train_end], y[:train_end]
    X_val, y_val = X[train_end:val_end], y[train_end:val_end]
    # O Teste real (ground truth)
    X_test, y_test = X[val_end:], y[val_end:]
    
    # Data de corte para o gráfico
    test_start_date = dates[val_end]

    # 5. Flatten (3D -> 2D)
    X_train_flat = X_train.reshape(X_train.shape[0], -1)
    X_val_flat = X_val.reshape(X_val.shape[0], -1)
    
    # IMPORTANTE: Preparar a matriz COMPLETA para previsão final
    X_full_flat = X.reshape(X.shape[0], -1)
    
    # 6. Scaling
    scaler = StandardScaler()
    # Fit apenas no treino para evitar data leakage
    X_train_s = scaler.fit_transform(X_train_flat)
    X_val_s = scaler.transform(X_val_flat)
    
    # Transform na matriz completa usando a régua do treino
    X_full_s = scaler.transform(X_full_flat)
    
    # Transform no teste específico (para cálculo de métricas isolado se precisasse, 
    # mas usaremos o full fatiado depois)
    X_test_s = scaler.transform(X_test.reshape(X_test.shape[0], -1))
    
    # 7. Treino (XGBoost)
    model = xgb.XGBRegressor(
        n_estimators=1000,
        learning_rate=0.05,
        max_depth=5,
        subsample=0.8,
        colsample_bytree=0.8,
        objective='reg:squarederror',
        n_jobs=1,
        random_state=args.seed
    )
    
    model.fit(
        X_train_s, y_train,
        eval_set=[(X_val_s, y_val)],
        early_stopping_rounds=30,
        verbose=False
    )
    
    # 8. Previsão na SÉRIE COMPLETA (Histórico + Futuro) 
    y_pred_full = model.predict(X_full_s)
    
    # Recortar apenas a parte do teste para calcular as métricas oficiais
    # (Assim a métrica reflete apenas o desempenho no "futuro" desconhecido)
    y_pred_test_only = y_pred_full[val_end:]
    y_true_test_only = y[val_end:]
    
    mae = mean_absolute_error(y_true_test_only, y_pred_test_only)
    mse = mean_squared_error(y_true_test_only, y_pred_test_only)
    rmse = np.sqrt(mse)
    r2 = r2_score(y_true_test_only, y_pred_test_only)
    
    # 9. Outputs
    city_out_dir = Path(args.outdir) / disease_name / str(cod_mun)
    ensure_dir(city_out_dir)
    
    # Salvar CSV de predição COMPLETA (inclui treino, validação e teste)
    df_res_full = pd.DataFrame({
        'date': dates, 
        'y_true': y, 
        'y_pred': y_pred_full
    })
    df_res_full.to_csv(city_out_dir / "predictions.csv", index=False)
    
    # Gerar os 7 Gráficos (passando a data de início do teste)
    try:
        generate_plots(df_res_full, city_out_dir, cod_mun, disease_name, test_start_date=test_start_date)
    except Exception as e:
        with open(Path(args.outdir) / "plot_errors.log", "a") as f:
            f.write(f"{disease_name},{cod_mun},{str(e)}\n")

    # Salvar Métricas JSON
    def clean_metric(val):
        if val is None or np.isnan(val) or np.isinf(val):
            return None
        return float(val)

    metrics = {
        'disease': str(disease_name),
        'cod_mun': int(cod_mun),
        'mae': clean_metric(mae),
        'rmse': clean_metric(rmse),
        'r2': clean_metric(r2),
        'n_train': int(len(y_train)),
        'n_test': int(len(y_test))
    }
    
    try:
        with open(city_out_dir / "metrics.json", 'w') as f:
            json.dump(metrics, f, indent=4)
    except Exception as e:
        print(f"ERRO CRÍTICO ao salvar JSON {disease_name}/{cod_mun}: {e}")
        
    return metrics

# ---------------------------
# 3. Main Loop (Batch)
# ---------------------------

def main():
    parser = argparse.ArgumentParser(description="Batch XGBoost Forecasting (Full History)")
    parser.add_argument('--input_dir', required=True, help='Pasta com os CSVs (ex: data/for_model)')
    parser.add_argument('--outdir', default='results/batch_run', help='Pasta para salvar resultados')
    parser.add_argument('--forecast_horizon', type=int, default=1)
    parser.add_argument('--test_size', type=int, default=12)
    parser.add_argument('--val_size', type=int, default=12)
    parser.add_argument('--seed', type=int, default=42)
    args = parser.parse_args()

    # Encontrar arquivos CSV
    input_path = Path(args.input_dir)
    files = list(input_path.glob("df_base_*.csv"))
    
    if not files:
        print(f"Nenhum arquivo 'df_base_*.csv' encontrado em {args.input_dir}")
        return

    print(f"Encontrados {len(files)} arquivos de dataset.")
    ensure_dir(args.outdir)
    
    all_metrics = []

    # Loop por arquivo (Doença)
    for file in files:
        file_name = file.stem 
        disease_name = file_name.replace("df_base_", "")
        
        print(f"\n>>> Processando dataset: {disease_name}")
        
        # Carregar Dataset Inteiro
        try:
            df_full = pd.read_csv(file)
            df_full.columns = [c.strip() for c in df_full.columns]
            
            # Ajustar Data
            if 'date' in df_full.columns:
                df_full['date'] = pd.to_datetime(df_full['date'])
            elif 'ds' in df_full.columns:
                df_full['date'] = pd.to_datetime(df_full['ds'])
            else:
                print(f"ERRO: Coluna de data não encontrada em {file_name}. Pulando.")
                continue
                
        except Exception as e:
            print(f"ERRO ao abrir {file_name}: {e}")
            continue

        # Identificar Municípios únicos
        if 'cod_mun' not in df_full.columns:
            print(f"ERRO: Coluna 'cod_mun' não encontrada em {file_name}. Pulando.")
            continue
            
        cities = df_full['cod_mun'].unique()
        print(f"   > Total de municípios encontrados: {len(cities)}")
        
        # Loop por Município com barra de progresso
        for cod in tqdm(cities, desc=f"Mun ({disease_name})", unit="city"):
            # Filtrar dados da cidade
            df_city = df_full[df_full['cod_mun'] == cod].copy()
            df_city = df_city.sort_values('date').reset_index(drop=True)
            
            # Processar
            try:
                res = process_single_city(df_city, disease_name, cod, args)
                if res:
                    all_metrics.append(res)
            except Exception as e:
                # Log silencioso de erro para não parar o batch
                with open(Path(args.outdir) / "errors.log", "a") as errlog:
                    errlog.write(f"{disease_name},{cod},{str(e)}\n")

    # Salvar Resumo Final
    if all_metrics:
        df_summary = pd.DataFrame(all_metrics)
        summary_path = Path(args.outdir) / "summary_metrics.csv"
        df_summary.to_csv(summary_path, index=False)
        print(f"\nBatch concluído com sucesso!")
        print(f"Resumo salvo em: {summary_path}")
        print(f"Média R2 Global: {df_summary['r2'].mean():.4f}")
    else:
        print("\nNenhum modelo foi treinado com sucesso (verifique dados ou logs).")

if __name__ == "__main__":
    main()