import os
import pandas as pd
import numpy as np
from prophet import Prophet
from tqdm import tqdm
from pathlib import Path

# -------- CONFIGURAÇÃO FILTRADA --------
INPUT_FILE = "data/for_model/df_base_TX_hiv_aids_00_23.csv"
OUTPUT_BASE_DIR = "results/prophet_hiv_aids_custom"
FORECAST_MONTHS = 160 

# As 3 variáveis mais influentes solicitadas
TOP_REGRESSORS = ['Dens_demog_SP', 'Urban_SP', 'Evapot_SP']
# ---------------------------------------

def prepare_data_hiv_aids(df, cod_mun):
    """Filtra município e limpa os dados"""
    df_mun = df[df['cod_mun'] == cod_mun].copy()
    if len(df_mun) < 12:
        return None
    
    df_mun = df_mun.rename(columns={'date': 'ds', 'target': 'y'})
    df_mun['ds'] = pd.to_datetime(df_mun['ds'])
    
    # Limpeza básica
    df_mun['y'] = df_mun['y'].clip(lower=0)
    
    # Tratamento específico para os 3 regressores
    for reg in TOP_REGRESSORS:
        if reg in df_mun.columns:
            df_mun[reg] = pd.to_numeric(df_mun[reg], errors='coerce')
            df_mun[reg] = df_mun[reg].interpolate(method='linear').ffill().bfill()
        else:
            print(f"⚠️ Aviso: Regressor {reg} não encontrado para o município {cod_mun}")
            return None
            
    return df_mun.sort_values('ds')

def run_custom_model(df_mun, cod_mun):
    """Treina o Prophet com os 3 regressores específicos"""
    try:
        m = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=False,
            daily_seasonality=False,
            seasonality_mode='multiplicative'
        )
        
        # Adiciona apenas os 3 regressores selecionados
        for reg in TOP_REGRESSORS:
            m.add_regressor(reg)
            
        m.fit(df_mun)
        
        # Criar dataframe futuro
        future = m.make_future_dataframe(periods=FORECAST_MONTHS, freq='MS')
        
        # Projetar regressores (usando a última observação para estabilidade)
        for reg in TOP_REGRESSORS:
            last_val = df_mun[reg].iloc[-1]
            future[reg] = df_mun[reg].reindex(future.index).fillna(last_val)
            # Se quiser usar tendência linear, pode usar a lógica do script anterior aqui
            
        forecast = m.predict(future)
        
        # Organizar saída
        res = forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()
        res = res.merge(df_mun[['ds', 'y']], on='ds', how='left')
        res = res.rename(columns={'y': 'y_true', 'yhat': 'y_pred'})
        res['cod_mun'] = cod_mun
        res[['y_pred', 'yhat_lower', 'yhat_upper']] = res[['y_pred', 'yhat_lower', 'yhat_upper']].clip(lower=0)
        
        return res
    except Exception as e:
        return None

def main():
    if not os.path.exists(INPUT_FILE):
        print(f"Erro: Arquivo {INPUT_FILE} não encontrado.")
        return

    print(f"Iniciando Modelagem de HIV/AIDS com: {TOP_REGRESSORS}")
    df_full = pd.read_csv(INPUT_FILE)
    municipios = df_full['cod_mun'].unique()
    
    for cod in tqdm(municipios, desc="Processando Municípios"):
        df_mun = prepare_data_hiv_aids(df_full, cod)
        
        if df_mun is not None:
            res_df = run_custom_model(df_mun, cod)
            
            if res_df is not None:
                out_dir = os.path.join(OUTPUT_BASE_DIR, str(cod))
                os.makedirs(out_dir, exist_ok=True)
                res_df.to_csv(os.path.join(out_dir, "history.csv"), index=False)

    print(f"\n✅ Concluído! Resultados em: {OUTPUT_BASE_DIR}")

if __name__ == "__main__":
    main()