#!/usr/bin/env python3
"""
calc_metrics_prophet.py

Funcionalidade:
1. Varre a pasta de resultados do Prophet (ex: results/prophet).
2. Encontra todos os arquivos 'history.csv'.
3. Calcula métricas (RMSE, MAE, R2) comparando 'y_true' vs 'y_pred'.
4. Salva um arquivo 'metrics.json' na mesma pasta do município.
5. Gera um CSV resumo de todas as doenças/municípios.

Não requer re-treinamento do modelo.
"""

import os
import glob
import json
import argparse
import pandas as pd
import numpy as np
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from tqdm import tqdm
from pathlib import Path

# --- Configurações ---
DEFAULT_INPUT_DIR = "results/prophet"

def clean_metric(val):
    """Converte numpy types para tipos nativos do Python (JSON safe)."""
    if val is None or pd.isna(val) or np.isinf(val):
        return None
    return float(val)

def calculate_and_save_metrics(file_path):
    try:
        # Carregar apenas colunas necessárias
        df = pd.read_csv(file_path)
        
        # Filtrar apenas linhas que tem valor Real (y_true) E Previsão (y_pred)
        # O history.csv do seu script tem o futuro (onde y_true é vazio), precisamos ignorar isso
        df_valid = df.dropna(subset=['y_true', 'y_pred']).copy()
        
        if len(df_valid) < 2:
            return None # Dados insuficientes para métricas

        y_true = df_valid['y_true']
        y_pred = df_valid['y_pred']

        # Cálculos
        mae = mean_absolute_error(y_true, y_pred)
        mse = mean_squared_error(y_true, y_pred)
        rmse = np.sqrt(mse)
        r2 = r2_score(y_true, y_pred)

        # Extrair metadados (assume que as colunas existem no CSV conforme seu script anterior)
        disease = str(df['disease'].iloc[0]) if 'disease' in df.columns else 'unknown'
        cod_mun = int(df['cod_mun'].iloc[0]) if 'cod_mun' in df.columns else 0

        # Montar Dicionário
        metrics = {
            'disease': disease,
            'cod_mun': cod_mun,
            'mae': clean_metric(mae),
            'rmse': clean_metric(rmse),
            'r2': clean_metric(r2),
            'n_samples': int(len(df_valid))
        }

        # Salvar JSON na mesma pasta do CSV
        parent_dir = Path(file_path).parent
        json_path = parent_dir / "metrics.json"
        
        with open(json_path, 'w') as f:
            json.dump(metrics, f, indent=4)
            
        return metrics

    except Exception as e:
        print(f"Erro ao processar {file_path}: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Calcula métricas a partir de history.csv do Prophet")
    parser.add_argument('--input_dir', default=DEFAULT_INPUT_DIR, help='Pasta raiz onde estão os resultados')
    args = parser.parse_args()

    # Encontrar todos os history.csv recursivamente
    # Estrutura esperada: input_dir / disease / cod_mun / history.csv
    search_path = os.path.join(args.input_dir, "*", "*", "history.csv")
    files = glob.glob(search_path)
    
    if not files:
        print(f"Nenhum arquivo 'history.csv' encontrado em {search_path}")
        return

    print(f"Encontrados {len(files)} arquivos para processar.")
    
    all_metrics = []
    
    # Barra de progresso
    for file_path in tqdm(files, desc="Calculando Métricas"):
        res = calculate_and_save_metrics(file_path)
        if res:
            all_metrics.append(res)

    # Salvar Resumo Geral
    if all_metrics:
        df_summary = pd.DataFrame(all_metrics)
        summary_path = os.path.join(args.input_dir, "summary_metrics_prophet.csv")
        df_summary.to_csv(summary_path, index=False)
        
        print("\nProcessamento Concluído!")
        print(f"Resumo salvo em: {summary_path}")
        print(f"Média R2 Global: {df_summary['r2'].mean():.4f}")
        print(f"Total processado: {len(df_summary)}")
    else:
        print("Nenhuma métrica foi calculada.")

if __name__ == "__main__":
    main()