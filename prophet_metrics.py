import os
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
        df = pd.read_csv(file_path)
        
        # Filtra apenas linhas com Real e Predito (ignora o futuro vazio)
        df_valid = df.dropna(subset=['y_true', 'y_pred']).copy()
        
        if len(df_valid) < 2:
            return None 

        y_true = df_valid['y_true']
        y_pred = df_valid['y_pred']

        # Cálculos estatísticos
        mae = mean_absolute_error(y_true, y_pred)
        mse = mean_squared_error(y_true, y_pred)
        rmse = np.sqrt(mse)
        r2 = r2_score(y_true, y_pred)

        # Tenta pegar metadados das colunas ou do nome da pasta
        disease = str(df['disease'].iloc[0]) if 'disease' in df.columns else 'sifilis'
        cod_mun = int(df['cod_mun'].iloc[0]) if 'cod_mun' in df.columns else Path(file_path).parent.name

        metrics = {
            'disease': disease,
            'cod_mun': cod_mun,
            'mae': clean_metric(mae),
            'rmse': clean_metric(rmse),
            'r2': clean_metric(r2),
            'n_samples': int(len(df_valid))
        }

        # Salva o JSON na mesma pasta
        json_path = Path(file_path).parent / "metrics.json"
        with open(json_path, 'w') as f:
            json.dump(metrics, f, indent=4)
            
        return metrics

    except Exception as e:
        print(f"Erro ao processar {file_path}: {e}")
        return None

def main():
    parser = argparse.ArgumentParser(description="Calcula métricas de forma recursiva")
    parser.add_argument('--input_dir', default=DEFAULT_INPUT_DIR, help='Pasta raiz dos resultados')
    args = parser.parse_args()

    # MUDANÇA CHAVE: Busca recursiva (rglob) em vez de caminhos fixos
    base_path = Path(args.input_dir)
    print(f"Buscando arquivos em: {base_path.absolute()}")
    
    files = list(base_path.rglob("history.csv"))
    
    if not files:
        print(f"❌ Nenhum arquivo 'history.csv' encontrado recursivamente em {args.input_dir}")
        return

    print(f"🔍 Encontrados {len(files)} arquivos para processar.")
    
    all_metrics = []
    for file_path in tqdm(files, desc="Calculando Métricas"):
        res = calculate_and_save_metrics(file_path)
        if res:
            all_metrics.append(res)

    if all_metrics:
        df_summary = pd.DataFrame(all_metrics)
        summary_path = base_path / "summary_metrics_prophet.csv"
        df_summary.to_csv(summary_path, index=False)
        
        print(f"\n✅ Processamento Concluído!")
        print(f"📊 Resumo salvo em: {summary_path}")
        print(f"📈 Média R2 Global: {df_summary['r2'].mean():.4f}")
    else:
        print("Nenhuma métrica foi calculada.")

if __name__ == "__main__":
    main()