#!/usr/bin/env python3
"""
run_prophet_municipio_full_history.py

Gera um CSV consolidado (Histórico Real + Previsão Ajustada/Futura)
SALVO EM PASTAS INDIVIDUAIS POR MUNICÍPIO.
Ex: results/prophet_full/hanseniase/3500105/history.csv
"""

import os
import glob
import pandas as pd
import numpy as np
from prophet import Prophet
from tqdm import tqdm
import warnings
import logging

# Configuração para silenciar logs do Prophet
logging.getLogger('cmdstanpy').setLevel(logging.WARNING)
warnings.filterwarnings("ignore")

# -------- CONFIGURAÇÕES --------
INPUT_DIR = "data/for_model"       # Onde estão os CSVs originais
OUTPUT_BASE_DIR = "results/prophet" # Pasta base para os resultados
FORECAST_HORIZON_MONTHS = 120       # Quantos meses prever para frente
# -------------------------------

def ensure_dir(path):
    """Cria o diretório se ele não existir."""
    if not os.path.exists(path):
        os.makedirs(path)

# --- Funções Auxiliares (mantidas do script anterior) ---
def get_disease_files():
    """Encontra os arquivos df_base_*.csv"""
    return glob.glob(os.path.join(INPUT_DIR, "df_base_*.csv"))

def prepare_regressors(df):
    """
    Identifica e prepara regressores.
    """
    potential_regs = [
        'Dens_demog_SP', 'Evapot_SP', 'Indice_PPC_SP', 'Pop_Geral_SP', 
        'Precip_SP', 'Temp_Max_SP', 'Temp_Min_SP', 'Umid_SP', 'Urban_SP'
    ]
    
    valid_regs = [c for c in potential_regs if c in df.columns]
    
    for col in valid_regs:
        df[col] = pd.to_numeric(df[col], errors='coerce')
        df[col] = df[col].interpolate(method='linear').ffill().bfill()
        if df[col].isnull().any():
            df[col] = df[col].fillna(df[col].mean())
            
    return df, valid_regs

def create_future_dataframe_with_regressors(model, df_history, periods, regressors):
    """
    Cria o dataframe futuro e projeta os regressores.
    """
    future = model.make_future_dataframe(periods=periods, freq='MS')
    if not regressors: return future
    
    future = future.merge(df_history[['ds'] + regressors], on='ds', how='left')
    for reg in regressors:
        last_val = df_history[reg].iloc[-1]
        future[reg] = future[reg].fillna(last_val)
        
    return future

def process_municipio(df_mun, cod_mun, disease_name, horizon):
    """Treina e prevê para um município."""
    try:
        # Preparação básica
        df_prophet = df_mun.rename(columns={'date': 'ds', 'target': 'y'})
        if 'ds' not in df_prophet.columns and 'ds' in df_mun.columns:
             df_prophet = df_mun.rename(columns={'target': 'y'})
             
        df_prophet['ds'] = pd.to_datetime(df_prophet['ds'])
        df_prophet = df_prophet.sort_values('ds').reset_index(drop=True)
        
        if len(df_prophet) < 12:
            return None

        # Regressores
        df_prophet, active_regs = prepare_regressors(df_prophet)

        # Configurar Modelo
        m = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=False,
            daily_seasonality=False,
            seasonality_mode='multiplicative'
        )
        
        for reg in active_regs:
            m.add_regressor(reg)

        # Treino
        m.fit(df_prophet)

        # Criar Futuro (Inclui o passado)
        future = create_future_dataframe_with_regressors(m, df_prophet, horizon, active_regs)
        
        # Previsão
        forecast = m.predict(future)
        
        # Organizar Resultado
        res = forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()
        
        # Merge com Dados Reais (y)
        res = res.merge(df_prophet[['ds', 'y']], on='ds', how='left')
        
        # Renomear e adicionar metadados
        res = res.rename(columns={'y': 'y_true', 'yhat': 'y_pred'})
        res['cod_mun'] = cod_mun
        res['disease'] = disease_name
        
        # Clips (sem valores negativos)
        res['y_pred'] = res['y_pred'].clip(lower=0)
        res['yhat_lower'] = res['yhat_lower'].clip(lower=0)
        res['yhat_upper'] = res['yhat_upper'].clip(lower=0)

        return res

    except Exception as e:
        # Em produção, pode ser útil logar o erro detalhado:
        # print(f"Erro ao processar mun {cod_mun} para {disease_name}: {e}")
        return None
# --------------------------------------------------------


def main():
    print(f"Iniciando processamento completo para {FORECAST_HORIZON_MONTHS} meses...")
    
    files = get_disease_files()
    print(f"Arquivos de entrada encontrados: {len(files)}")
    
    # Processa cada arquivo de doença
    for file_path in files:
        file_name = os.path.basename(file_path)
        disease_name = file_name.replace("df_base_", "").replace("TX_", "").replace("_00_23.csv", "")
        
        print(f"\n>>> Processando: {disease_name.upper()}")
        
        df_full = pd.read_csv(file_path)
        df_full.columns = [c.strip() for c in df_full.columns]
        
        if 'ds' in df_full.columns: df_full['date'] = df_full['ds']
        if 'cod_mun' not in df_full.columns: continue
            
        cities = df_full['cod_mun'].unique()
        
        # Barra de progresso para os municípios
        for cod in tqdm(cities, desc=f"Municípios ({disease_name})"):
            df_mun = df_full[df_full['cod_mun'] == cod].copy()
            
            res_df = process_municipio(df_mun, cod, disease_name, FORECAST_HORIZON_MONTHS)
            
            if res_df is not None:
                # --- NOVO TRECHO DE SALVAMENTO ---
                
                # 1. Define o caminho de saída exato: results/prophet_full/<disease>/<cod_mun>
                output_dir_mun = os.path.join(OUTPUT_BASE_DIR, disease_name, str(cod))
                
                # 2. Cria as pastas
                ensure_dir(output_dir_mun)
                
                # 3. Define o nome e salva o arquivo
                out_file = os.path.join(output_dir_mun, "history.csv")
                
                # Reordenar colunas
                cols = ['ds', 'cod_mun', 'disease', 'y_true', 'y_pred', 'yhat_lower', 'yhat_upper']
                res_df = res_df[cols]
                
                res_df.to_csv(out_file, index=False)
                # --------------------------------

    print("\nProcesso concluído!")
    print(f"Os arquivos foram salvos individualmente em: {OUTPUT_BASE_DIR}/<doenca>/<municipio>/history.csv")

if __name__ == "__main__":
    main()