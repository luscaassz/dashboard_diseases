#!/usr/bin/env python3
"""
organize_priority_excel_fixed.py

Funcionalidade:
1. Lê o arquivo Excel 'data/Indice_PPC_SP.xlsx'.
2. Usa as colunas 'CD_MUN' e 'MUN' para mapear nomes -> códigos.
3. Filtra apenas as cidades prioritárias da sua lista.
4. Copia os resultados para a pasta 'results_prioritarios'.
"""

import os
import shutil
import pandas as pd
import unicodedata
from pathlib import Path
from tqdm import tqdm

# --- CONFIGURAÇÕES ---
EXCEL_PATH = "data/Indice_PPC_SP.xlsx"
RESULTS_XGB_DIR = "results/xgboost_all"
RESULTS_PROPHET_DIR = "results/prophet"
OUTPUT_DIR = "results_priorities"

# NOMES EXATOS DAS COLUNAS (Conforme seu erro)
COL_CODIGO = 'CD_MUN'  # Coluna com o código IBGE
COL_NOME = 'MUN'       # Coluna com o nome da cidade

# Lista de Cidades Prioritárias
PRIORITY_NAMES = [
    "Barueri", "Bauru", "Campinas", "Carapicuíba", "Diadema", "Guarujá", 
    "Guarulhos", "Itapevi", "Jundiaí", "Mauá", "Osasco", "Paulínia", 
    "Praia Grande", "Ribeirão Preto", "Santo André", "Santos", 
    "São Bernardo do Campo", "São José do Rio Preto", "São José dos Campos", 
    "São Paulo", "São Vicente", "Sorocaba", "Taboão da Serra"
]

def normalize_text(text):
    """Remove acentos, espaços extras e coloca em minúsculo."""
    if not isinstance(text, str): return str(text).lower()
    text = text.lower().strip()
    nfkd = unicodedata.normalize('NFKD', text)
    return u"".join([c for c in nfkd if not unicodedata.combining(c)])

def get_mapping_from_excel():
    """Lê o Excel e retorna um dicionário {codigo_ibge: nome_formatado}."""
    
    print(f">>> Lendo arquivo: {EXCEL_PATH}")
    
    try:
        df = pd.read_excel(EXCEL_PATH)
    except Exception as e:
        print(f"ERRO CRÍTICO: Não foi possível ler o Excel. Erro: {e}")
        return {}

    # Verificar se as colunas existem mesmo
    if COL_CODIGO not in df.columns or COL_NOME not in df.columns:
        print(f"ERRO: As colunas '{COL_CODIGO}' e '{COL_NOME}' não foram encontradas no Excel.")
        print(f"Colunas disponíveis: {list(df.columns)}")
        return {}

    print(f"   Usando colunas -> Código: '{COL_CODIGO}' | Nome: '{COL_NOME}'")
    
    excel_db = {}
    for _, row in df.iterrows():
        try:
            # Normaliza o nome (ex: 'São Paulo' -> 'sao paulo')
            raw_name = row[COL_NOME]
            clean_name = normalize_text(raw_name)
            
            # Pega o código
            code = int(row[COL_CODIGO])
            
            excel_db[clean_name] = code
        except ValueError:
            continue 

    # --- CRUZAMENTO COM A SUA LISTA ---
    final_mapping = {}
    print("\n--- Verificando Cidades Prioritárias ---")
    
    found_count = 0
    for target in PRIORITY_NAMES:
        target_norm = normalize_text(target)
        
        if target_norm in excel_db:
            code = excel_db[target_norm]
            # Formata nome para pasta
            folder_name = target.replace(" ", "_")
            # Remove acentos para o nome da pasta ficar seguro
            folder_name_clean = unicodedata.normalize('NFKD', folder_name).encode('ASCII', 'ignore').decode('ASCII')
            
            final_mapping[code] = folder_name_clean
            print(f"[OK] {target} -> Cód: {code}")
            found_count += 1
        else:
            print(f"[ERRO] {target} não encontrada no Excel (Busquei por: '{target_norm}')")
            
    if found_count == 0:
        print("\nAVISO CRÍTICO: Nenhuma cidade foi encontrada. Verifique se os nomes no Excel batem com a lista.")
        
    return final_mapping

def copy_folder_structure(src_root, dest_root, mapping, model_name):
    print(f"\n>>> Copiando pastas do {model_name.upper()}...")
    src_path = Path(src_root)
    dest_path = Path(dest_root) / model_name
    
    if dest_path.exists():
        shutil.rmtree(dest_path)
    dest_path.mkdir(parents=True, exist_ok=True)
    
    copied_count = 0
    
    if not src_path.exists():
        print(f"Pasta de origem não existe: {src_path}")
        return

    # Itera sobre as doenças
    for disease_dir in src_path.iterdir():
        if not disease_dir.is_dir(): continue
        
        # Itera sobre os municípios
        for mun_dir in disease_dir.iterdir():
            try:
                current_code = int(mun_dir.name)
                
                if current_code in mapping:
                    city_name = mapping[current_code]
                    new_folder_name = f"{city_name}_{current_code}"
                    
                    target_dir = dest_path / disease_dir.name / new_folder_name
                    
                    shutil.copytree(mun_dir, target_dir)
                    copied_count += 1
                    
            except ValueError:
                continue 

    print(f"Total copiado: {copied_count} pastas.")

def main():
    mapping = get_mapping_from_excel()
    
    if not mapping:
        return

    copy_folder_structure(RESULTS_XGB_DIR, OUTPUT_DIR, mapping, "xgboost")
    copy_folder_structure(RESULTS_PROPHET_DIR, OUTPUT_DIR, mapping, "prophet")

    print(f"\n--- Processo Finalizado ---")
    print(f"Arquivos organizados em: {os.path.abspath(OUTPUT_DIR)}")

if __name__ == "__main__":
    main()