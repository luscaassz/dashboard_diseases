#!/usr/bin/env python3
"""
generate_plots_only.py - Versão 3.0 (Adaptada para Prophet Full History)

Gera os 7 gráficos de diagnóstico e previsão para todos os arquivos 'history.csv' 
encontrados no diretório de entrada (results/prophet_full).
"""

import os
import glob
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns
from tqdm import tqdm
import warnings
import argparse

warnings.filterwarnings("ignore")
sns.set_style("whitegrid")
# Garantir que o Matplotlib funcione em ambientes sem display gráfico (útil para servidores)
plt.switch_backend('Agg')

# --- CONFIGURAÇÃO ---
# O script agora espera que você passe o diretório base como argumento
DEFAULT_INPUT_DIR = "results/prophet" 
# --------------------

def calculate_metrics(y_true, y_pred):
    """Calcula e retorna as métricas de erro (RMSE, MAE) na janela de validação."""
    errors = y_pred - y_true
    rmse = np.sqrt(np.mean(errors**2))
    mae = np.mean(np.abs(errors))
    return rmse, mae

def generate_plots(df, folder_path, filename_prefix, rmse=None, mae=None):
    """Gera e salva os 7 gráficos na pasta especificada."""
    
    # Mapeamento para nomes internos
    df['date'] = pd.to_datetime(df['ds'])
    y_true_full = df['y_true'].values
    y_pred_full = df['y_pred'].values
    dates_full = df['date']
    
    # 1. Forecast vs Actual (Gráfico Principal)
    plt.figure(figsize=(12, 6))
    
    # Plot Histórico Real (onde y_true não é NaN)
    mask_hist = ~np.isnan(y_true_full)
    plt.plot(dates_full[mask_hist], y_true_full[mask_hist], label='Histórico Real', color='black', alpha=0.7)
    
    # Plot Previsão (onde y_pred não é NaN, cobre passado ajustado e futuro)
    plt.plot(dates_full, y_pred_full, label='Modelo Prophet', linestyle='--', color='dodgerblue')
    
    # Plot Intervalo de Confiança (Se as colunas existirem)
    if 'yhat_lower' in df.columns:
        plt.fill_between(dates_full, df['yhat_lower'], df['yhat_upper'], color='dodgerblue', alpha=0.2, label='Intervalo Confiança')
        
    title_suffix = f" (RMSE: {rmse:.2f} | MAE: {mae:.2f})" if rmse and mae else ""
    plt.title(f"Previsão vs Real - {filename_prefix}{title_suffix}")
    plt.legend()
    plt.tight_layout()
    plt.savefig(os.path.join(folder_path, f"{filename_prefix}_1_forecast_vs_actual.png"))
    plt.close()

    # --- Foco na Janela de Validação (Onde y_true tem valor E y_pred tem valor) ---
    
    # Filtrar dados para cálculo de erros (Apenas onde temos Histórico)
    mask_valid = mask_hist & ~np.isnan(y_pred_full)
    
    if np.sum(mask_valid) < 2:
        # Se não há sobreposição suficiente (só futuro, etc.), pular gráficos de erro.
        return

    y_true_valid = y_true_full[mask_valid]
    y_pred_valid = y_pred_full[mask_valid]
    dates_valid = dates_full[mask_valid]
    errors = y_pred_valid - y_true_valid
    
    # 2. Erro Absoluto
    plt.figure(figsize=(12, 6))
    plt.plot(dates_valid, np.abs(errors), color='salmon', marker='o', linestyle='-', markersize=2)
    plt.title(f"Erro Absoluto (Histórico) - {filename_prefix}")
    plt.tight_layout()
    plt.savefig(os.path.join(folder_path, f"{filename_prefix}_2_forecast_error.png"))
    plt.close()

    # 3. Distribuição de Erros (Resíduos)
    plt.figure(figsize=(10, 6))
    sns.histplot(errors, kde=True, bins=15, color='crimson')
    plt.title(f'Distribuição de Erros - {filename_prefix}')
    plt.tight_layout()
    plt.savefig(os.path.join(folder_path, f"{filename_prefix}_3_error_dist.png"))
    plt.close()

    # 4. Scatter (Real vs Previsto)
    plt.figure(figsize=(8, 8))
    plt.scatter(y_true_valid, y_pred_valid, alpha=0.6, c='purple')
    min_val = min(y_true_valid.min(), y_pred_valid.min())
    max_val = max(y_true_valid.max(), y_pred_valid.max())
    plt.plot([min_val, max_val], [min_val, max_val], 'k--', lw=2)
    plt.xlabel('Valor Real')
    plt.ylabel('Valor Ajustado/Previsto')
    plt.title(f'Real vs Ajustado/Previsto (Histórico) - {filename_prefix}')
    plt.tight_layout()
    plt.savefig(os.path.join(folder_path, f"{filename_prefix}_4_scatter.png"))
    plt.close()

    # 5. Resíduos no Tempo
    plt.figure(figsize=(12, 6))
    plt.plot(dates_valid, errors, marker='o', linestyle='-', color='orange', markersize=2)
    plt.axhline(0, color='black', linestyle='--')
    plt.title(f'Resíduos no Tempo - {filename_prefix}')
    plt.tight_layout()
    plt.savefig(os.path.join(folder_path, f"{filename_prefix}_5_residuals_time.png"))
    plt.close()

    # 6. Média Móvel Erro (Para identificar viés persistente)
    window = max(2, len(errors)//10)
    rolling_error = pd.Series(errors).rolling(window=window).mean()
    plt.figure(figsize=(12, 6))
    plt.plot(dates_valid, rolling_error, color='purple', linewidth=2)
    plt.axhline(0, color='gray', linestyle='--')
    plt.title(f'Média Móvel Erros (Janela={window}) - {filename_prefix}')
    plt.tight_layout()
    plt.savefig(os.path.join(folder_path, f"{filename_prefix}_6_rolling_error.png"))
    plt.close()

    # 7. Erro Acumulado (Viés Acumulado)
    cumulative = np.cumsum(errors)
    plt.figure(figsize=(12, 6))
    plt.plot(dates_valid, cumulative, color='teal', linewidth=2)
    plt.axhline(0, color='black', linestyle='--')
    plt.title(f'Erro Acumulado (Viés Total) - {filename_prefix}')
    plt.tight_layout()
    plt.savefig(os.path.join(folder_path, f"{filename_prefix}_7_cumulative_error.png"))
    plt.close()


def main():
    parser = argparse.ArgumentParser(description="Gera 7 gráficos de diagnóstico e previsão a partir de CSVs completos (history.csv).")
    parser.add_argument("--input_dir", type=str, default=DEFAULT_INPUT_DIR, 
                        help=f"Diretório raiz onde buscar os CSVs (Ex: {DEFAULT_INPUT_DIR})")
    args = parser.parse_args()
    
    search_path = os.path.join(args.input_dir, "**", "history.csv")
    csv_files = glob.glob(search_path, recursive=True)
    
    print(f"--- Iniciando Geração de Gráficos ---")
    print(f"Buscando 'history.csv' em: {args.input_dir}")
    print(f"Encontrados {len(csv_files)} arquivos para processar.")
    
    if not csv_files:
        print("Nenhum arquivo 'history.csv' encontrado. Verifique o caminho de entrada.")
        return

    for filepath in tqdm(csv_files, desc="Gerando Gráficos"):
        try:
            df = pd.read_csv(filepath)
            
            # --- VALIDAÇÃO DE COLUNAS ---
            required_cols = ['ds', 'y_true', 'y_pred']
            if not all(col in df.columns for col in required_cols):
                print(f"Arquivo {filepath} pulado: Faltam colunas obrigatórias ({required_cols}).")
                continue
                
            # Identificação do prefixo
            folder_path = os.path.dirname(filepath)
            
            # Subir um nível para pegar o nome da doença e o código do município
            # Ex: .../prophet_full/hanseniase/3500105/history.csv
            cod_mun = os.path.basename(folder_path) # 3500105
            disease_name = os.path.basename(os.path.dirname(folder_path)) # hanseniase
            
            filename_prefix = f"{cod_mun}_{disease_name}"
            
            # --- CÁLCULO DE MÉTRICAS (apenas onde y_true e y_pred são válidos) ---
            
            # Filtro para cálculo de métricas (apenas o histórico ajustado)
            df_metrics = df.dropna(subset=['y_true', 'y_pred']).copy()
            
            # Remove o último ano para focar na parte de validação, se for o caso
            # Exemplo: Se rodamos com horizonte de 2 anos, mas queremos métricas só do treino.
            # Vamos usar TODOS os dados históricos disponíveis para as métricas, onde temos y_true e y_pred.
            
            if len(df_metrics) > 1:
                rmse, mae = calculate_metrics(df_metrics['y_true'].values, df_metrics['y_pred'].values)
            else:
                rmse, mae = None, None
            
            # Geração dos gráficos
            generate_plots(df, folder_path, filename_prefix, rmse, mae)
            
        except Exception as e:
            print(f"\nErro ao processar {filepath}: {e}")

    print("\n--- Processo de Plotagem Concluído! ---")
    print("Os gráficos foram salvos nas pastas dos respectivos municípios.")

if __name__ == "__main__":
    main()