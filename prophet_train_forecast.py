import os
import pandas as pd
import numpy as np
from prophet import Prophet
from datetime import datetime
import traceback
import glob
from tqdm import tqdm

# -------- CONFIG --------
INPUT_DIR = "data/for_model"
OUTPUT_BASE_DIR = "data/prophet"
FORECAST_END = "2035-12-01"
# ------------------------

# Mapeamento de arquivos para nomes de doenças
DISEASE_MAPPING = {
    'df_base_TX_hanseniase_00_23.csv': 'hanseniase',
    'df_base_TX_hepatite_00_23.csv': 'hepatite',
    'df_base_TX_hiv_aids_00_23.csv': 'hiv_aids',
    'df_base_TX_sifilis_00_23.csv': 'sifilis',
    'df_base_TX_tuberculose_00_23.csv': 'tuberculose'
}

def create_output_directory(disease_name, municipio_code):
    """Cria diretório de saída específico para cada doença e município"""
    output_dir = os.path.join(OUTPUT_BASE_DIR, disease_name, str(municipio_code))
    os.makedirs(output_dir, exist_ok=True)
    return output_dir

def get_disease_files():
    """Obtém a lista de arquivos de doenças disponíveis"""
    disease_files = []
    for file_pattern in DISEASE_MAPPING.keys():
        file_path = os.path.join(INPUT_DIR, file_pattern)
        if os.path.exists(file_path):
            disease_files.append(file_path)
        else:
            print(f"Aviso: Arquivo não encontrado: {file_path}")
    
    print(f"Encontrados {len(disease_files)} arquivos de doença")
    return disease_files

def get_municipios_from_file(file_path):
    """Extrai a lista de municípios únicos de um arquivo"""
    try:
        # Ler apenas a coluna cod_mun para eficiência
        df = pd.read_csv(file_path, usecols=['cod_mun'])
        municipios = df['cod_mun'].unique()
        print(f"Encontrados {len(municipios)} municípios em {os.path.basename(file_path)}")
        return municipios
    except Exception as e:
        print(f"Erro ao ler municípios de {file_path}: {e}")
        return []

def load_and_prepare_data(file_path, cod_mun, disease_name):
    """Carrega e prepara os dados para um município específico"""
    try:
        print(f"  Carregando dados para município {cod_mun}...")
        
        # Carregar dados
        df = pd.read_csv(file_path)
        
        # Filtrar município
        df_mun = df[df['cod_mun'] == cod_mun].copy()
        if df_mun.empty:
            print(f"  Aviso: Nenhum dado encontrado para município {cod_mun}")
            return None
        
        # Preparar datas e target
        df_mun['ds'] = pd.to_datetime(df_mun['date'])
        df_mun['y'] = df_mun['target']  # Variável alvo
        
        # Verificar e corrigir valores negativos no target
        negative_count = (df_mun['y'] < 0).sum()
        if negative_count > 0:
            print(f"  Aviso: {negative_count} valores negativos corrigidos no target")
            df_mun['y'] = df_mun['y'].clip(lower=0)
        
        # Ordenar por data
        df_mun = df_mun.sort_values('ds').reset_index(drop=True)
        
        # Verificar se há dados suficientes (pelo menos 12 meses)
        if len(df_mun) < 12:
            print(f"  Aviso: Município {cod_mun} tem apenas {len(df_mun)} registros. Mínimo recomendado: 12")
        
        return df_mun
        
    except Exception as e:
        print(f"  Erro ao carregar dados para município {cod_mun}: {e}")
        return None

def prepare_regressors(df):
    """Prepara as variáveis regressoras"""
    regressor_columns = [
        'Dens_demog_SP', 'Evapot_SP', 'Indice_PPC_SP', 'Pop_Geral_SP', 'Precip_SP', 
        'Temp_Max_SP', 'Temp_Min_SP', 'Umid_SP', 'Urban_SP'
    ]
    
    # Verificar se todas as colunas existem
    available_regressors = [col for col in regressor_columns if col in df.columns]
    missing = set(regressor_columns) - set(available_regressors)
    
    if missing:
        print(f"  Aviso: Regressores não encontrados: {missing}")
    
    # Criar DataFrame com regressores
    regs_df = df[['ds'] + available_regressors].copy()
    
    # Converter para numérico e tratar missing values
    for col in available_regressors:
        regs_df[col] = pd.to_numeric(regs_df[col], errors='coerce')
        
        # Verificar e corrigir valores negativos nos regressores
        negative_count = (regs_df[col] < 0).sum()
        if negative_count > 0:
            regs_df[col] = regs_df[col].clip(lower=0)
        
        # Preencher missing values
        regs_df[col] = regs_df[col].interpolate(method='linear').fillna(method='ffill').fillna(method='bfill')
        
        # Se ainda houver NaNs, preencher com a média
        if regs_df[col].isna().any():
            mean_val = regs_df[col].mean()
            regs_df[col] = regs_df[col].fillna(mean_val)
    
    return regs_df, available_regressors

def create_future_regressors(regs_df, regressors, future_dates):
    """Cria projeções realistas para regressores futuros"""
    future_regs = pd.DataFrame({'ds': future_dates})
    
    for reg in regressors:
        # Usar tendência linear baseada nos últimos 3 anos para projetar
        recent_data = regs_df[regs_df['ds'] >= regs_df['ds'].max() - pd.DateOffset(years=3)]
        
        if len(recent_data) > 1:
            # Calcular tendência linear
            x = (recent_data['ds'] - recent_data['ds'].min()).dt.days.values
            y = recent_data[reg].values
            
            try:
                slope = np.polyfit(x, y, 1)[0]
                
                # Projetar valores futuros baseados na tendência
                last_value = recent_data[reg].iloc[-1]
                days_future = (future_dates - recent_data['ds'].max()).days.values
                
                future_values = last_value + slope * days_future
                
                # Garantir que valores não fiquem negativos
                future_values = np.maximum(future_values, 0)
                
                future_regs[reg] = future_values
            except:
                # Em caso de erro, usar o último valor
                future_regs[reg] = regs_df[reg].iloc[-1]
        else:
            # Se não há dados suficientes, usar o último valor
            future_regs[reg] = regs_df[reg].iloc[-1]
    
    return future_regs

def run_prophet_forecast(df, regs_df, regressors, forecast_end, cod_mun, disease_name):
    """Executa o modelo Prophet e gera previsões"""
    try:
        # Preparar dados de treino
        train_df = df[['ds', 'y']].copy()
        
        # Adicionar regressores aos dados de treino
        if regressors and regs_df is not None:
            train_df = train_df.merge(regs_df, on='ds', how='left')
        
        # Remover linhas com y missing
        train_df = train_df.dropna(subset=['y'])
        
        if train_df.empty:
            print(f"  Aviso: Sem dados suficientes para treinar o modelo para município {cod_mun}")
            return None
        
        # Configurar modelo Prophet
        model = Prophet(
            yearly_seasonality=True,
            weekly_seasonality=False,
            daily_seasonality=False,
            changepoint_prior_scale=0.05,
            seasonality_prior_scale=10.0,
            holidays_prior_scale=10.0,
            seasonality_mode='multiplicative'
        )
        
        # Adicionar regressores
        for reg in regressors:
            model.add_regressor(reg)
        
        print(f"  Treinando modelo para município {cod_mun}...")
        model.fit(train_df)
        
        # Criar dados futuros
        last_date = train_df['ds'].max()
        future_dates = pd.date_range(
            start=last_date + pd.DateOffset(months=1),
            end=forecast_end,
            freq='MS'
        )
        
        # Criar DataFrame futuro com regressores projetados
        if regressors and regs_df is not None:
            future_df = create_future_regressors(regs_df, regressors, future_dates)
        else:
            future_df = pd.DataFrame({'ds': future_dates})
        
        # Fazer previsões
        forecast = model.predict(future_df)
        
        # Garantir que previsões não sejam negativas
        forecast['yhat'] = forecast['yhat'].clip(lower=0)
        forecast['yhat_lower'] = forecast['yhat_lower'].clip(lower=0)
        forecast['yhat_upper'] = forecast['yhat_upper'].clip(lower=0)
        
        # Preparar resultado final
        result_df = forecast[['ds', 'yhat', 'yhat_lower', 'yhat_upper']].copy()
        
        # Adicionar dados históricos para comparação
        historical_data = df[['ds', 'y']].rename(columns={'y': 'actual'})
        result_df = result_df.merge(historical_data, on='ds', how='left')
        
        # Adicionar metadados
        result_df['cod_mun'] = cod_mun
        result_df['nome_mun'] = df['nome_mun'].iloc[0] if 'nome_mun' in df.columns else 'Unknown'
        result_df['doenca'] = disease_name
        
        return result_df
        
    except Exception as e:
        print(f"  Erro ao executar previsão para município {cod_mun}: {e}")
        return None

def save_forecast_results(result_df, output_dir, cod_mun, disease_name):
    """Salva os resultados da previsão"""
    try:
        filename = f"forecast_{cod_mun}_{disease_name}.csv"
        filepath = os.path.join(output_dir, filename)
        
        # Selecionar colunas para salvar
        output_columns = ['ds', 'actual', 'yhat', 'yhat_lower', 'yhat_upper', 'cod_mun', 'nome_mun', 'doenca']
        available_columns = [col for col in output_columns if col in result_df.columns]
        
        result_df[available_columns].to_csv(filepath, index=False)
        return True
    except Exception as e:
        print(f"  Erro ao salvar resultados para {cod_mun}: {e}")
        return False

def process_municipio(file_path, cod_mun, disease_name, forecast_end):
    """Processa um único município para uma doença"""
    # Criar diretório de saída
    output_dir = create_output_directory(disease_name, cod_mun)
    
    # Carregar e preparar dados
    df = load_and_prepare_data(file_path, cod_mun, disease_name)
    if df is None:
        return False
    
    # Preparar regressores
    regs_df, regressors = prepare_regressors(df)
    
    # Executar previsão
    result_df = run_prophet_forecast(df, regs_df, regressors, forecast_end, cod_mun, disease_name)
    if result_df is None:
        return False
    
    # Salvar resultados
    success = save_forecast_results(result_df, output_dir, cod_mun, disease_name)
    
    if success:
        print(f"  ✓ Previsão concluída para {cod_mun}")
        return True
    else:
        print(f"  ✗ Erro ao salvar previsão para {cod_mun}")
        return False

def process_disease_file(file_path, forecast_end, max_municipios=None):
    """Processa todos os municípios de um arquivo de doença"""
    file_name = os.path.basename(file_path)
    disease_name = DISEASE_MAPPING.get(file_name, file_name.replace('df_base_TX_', '').replace('_00_23.csv', ''))
    
    print(f"\n{'='*60}")
    print(f"PROCESSANDO: {disease_name.upper()}")
    print(f"Arquivo: {file_name}")
    print(f"{'='*60}")
    
    # Obter lista de municípios
    municipios = get_municipios_from_file(file_path)
    
    if max_municipios:
        municipios = municipios[:max_municipios]
        print(f"  (Limitado aos primeiros {max_municipios} municípios para teste)")
    
    success_count = 0
    error_count = 0
    
    # Processar cada município
    for i, cod_mun in enumerate(tqdm(municipios, desc=f"  {disease_name}")):
        print(f"\n[{i+1}/{len(municipios)}] Processando município: {cod_mun}")
        
        try:
            if process_municipio(file_path, cod_mun, disease_name, forecast_end):
                success_count += 1
            else:
                error_count += 1
        except Exception as e:
            print(f"  ✗ Erro inesperado processando {cod_mun}: {e}")
            error_count += 1
    
    print(f"\n✅ {disease_name}: {success_count} sucessos, {error_count} erros")
    return success_count, error_count

def main():
    """Função principal"""
    print("INICIANDO PROCESSAMENTO DE TODAS AS DOENÇAS E MUNICÍPIOS")
    print(f"Data de previsão final: {FORECAST_END}")
    print(f"Diretório de entrada: {INPUT_DIR}")
    print(f"Diretório de saída: {OUTPUT_BASE_DIR}")
    
    # Criar diretório base de saída
    os.makedirs(OUTPUT_BASE_DIR, exist_ok=True)
    
    # Obter arquivos de doença
    disease_files = get_disease_files()
    
    if not disease_files:
        print("Nenhum arquivo de doença encontrado!")
        return
    
    total_success = 0
    total_errors = 0
    
    # Processar cada arquivo de doença
    for file_path in disease_files:
        try:
            # Para teste, processar apenas os primeiros 2 municípios de cada doença
            # Remova max_municipios=2 para processar todos
            success, errors = process_disease_file(file_path, pd.to_datetime(FORECAST_END), max_municipios=None)
            total_success += success
            total_errors += errors
        except Exception as e:
            print(f"Erro ao processar arquivo {file_path}: {e}")
            traceback.print_exc()
    
    # Resumo final
    print(f"\n{'='*60}")
    print("RESUMO FINAL")
    print(f"{'='*60}")
    print(f"Total de previsões bem-sucedidas: {total_success}")
    print(f"Total de erros: {total_errors}")
    print(f"Taxa de sucesso: {(total_success/(total_success+total_errors)*100):.1f}%")
    print(f"\nResultados salvos em: {OUTPUT_BASE_DIR}")
    print(f"Estrutura: {OUTPUT_BASE_DIR}/<doença>/<código_município>/forecast_<código>_<doença>.csv")

if __name__ == "__main__":
    main()