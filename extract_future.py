import os
import pandas as pd
from pathlib import Path

def extract_future_rates(input_dir, output_file):
    results = []
    base_path = Path(input_dir)
    files = list(base_path.rglob("history.csv"))

    if not files:
        print("Nenhum arquivo history.csv encontrado!")
        return

    for f in files:
        try:
            df = pd.read_csv(f)
            df['ds'] = pd.to_datetime(df['ds'])
            
            # Tenta pegar cod_mun da coluna ou do nome da pasta pai
            cod_mun = df['cod_mun'].values[0] if 'cod_mun' in df.columns else f.parent.name
            
            # Tenta pegar a doença ou assume hanseniase (já que o modelo foi customizado para ela)
            disease = df['disease'].values[0] if 'disease' in df.columns else "sifilis"
            
            # Filtrar datas específicas para 2030 e 2035 (Junho como referência de meio de ano)
            target_dates = [pd.Timestamp('2030-06-01'), pd.Timestamp('2035-06-01')]
            
            for date in target_dates:
                # Procura a data exata ou a mais próxima disponível
                row = df[df['ds'] == date]
                
                if not row.empty:
                    results.append({
                        'cod_mun': cod_mun,
                        'disease': disease,
                        'data_projecao': date.strftime('%Y-%m-%d'),
                        'taxa_predita': row['y_pred'].values[0],
                        'limite_inferior': row['yhat_lower'].values[0],
                        'limite_superior': row['yhat_upper'].values[0]
                    })
        except Exception as e:
            print(f"Erro ao processar arquivo {f}: {e}")

    if results:
        final_df = pd.DataFrame(results)
        # Ordenar para ficar organizado no artigo
        final_df = final_df.sort_values(['cod_mun', 'data_projecao'])
        final_df.to_csv(output_file, index=False)
        print(f"✅ Sucesso! Tabela salva em: {output_file}")
    else:
        print("❌ Nenhuma linha correspondente às datas foi encontrada nos arquivos.")

# Execução
extract_future_rates("results/prophet_sifilis_custom", "projecoes_sifilis_2030_2035.csv")