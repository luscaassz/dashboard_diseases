# 📈 Dashboard de Previsão de Doenças Municipais

Sistema completo para **treinamento, avaliação e visualização** de modelos de previsão de séries temporais aplicados a taxas de doenças (tuberculose, hepatite, HIV/AIDS, hanseníase, sífilis) em municípios do estado de São Paulo. Inclui pipelines com XGBoost e Prophet, além de um dashboard web para exploração dos dados históricos e previsões futuras.

![Python](https://img.shields.io/badge/Python-3.9%2B-blue)
![Flask](https://img.shields.io/badge/Flask-2.0-green)
![XGBoost](https://img.shields.io/badge/XGBoost-1.7-orange)
![Prophet](https://img.shields.io/badge/Prophet-1.1-blueviolet)
![License](https://img.shields.io/badge/License-MIT-lightgrey)

## Funcionalidades

### Modelagem e Previsão
- **XGBoost** – engenharia de features temporais (lags, médias móveis, diferenças, sazonalidade) e treinamento por município/doença.
- **Prophet** – modelo com sazonalidade anual e regressores externos (densidade, precipitação, temperatura, etc.).
- **Previsões até 2035** (Prophet) e até 2030 (XGBoost).
- **Métricas de avaliação** – MAE, RMSE, R².
- **7 gráficos de diagnóstico** por município: evolução real vs previsto, erros absolutos, distribuição de resíduos, dispersão, resíduos no tempo, média móvel e erro acumulado.

### Dashboard Web
- Seleção dinâmica entre **doenças** (tuberculose, hepatite, HIV/AIDS, hanseníase, sífilis) e **variáveis socioambientais** (índice PPC, umidade, urbanização, precipitação, população, evapotranspiração, densidade, temperaturas).
- Filtro por município (busca com autocomplete) e período (2000‑2023).
- Gráfico interativo (Chart.js) com suporte a **previsões futuras** (carregadas automaticamente dos CSVs gerados pelo Prophet).
- Painel de estatísticas descritivas (média, mediana, desvio padrão) para dados históricos e previsões.
- **Exportação** das previsões para Excel (XLSX) ou CSV.


## 🧰 Tecnologias

| Componente          | Ferramentas                                                                 |
|---------------------|------------------------------------------------------------------------------|
| **Backend**         | Python, Flask (para servir dados estáticos)                                 |
| **Machine Learning**| XGBoost, Prophet, scikit-learn, pandas, numpy, scipy                        |
| **Frontend**        | HTML5, CSS3, JavaScript (Chart.js, XLSX, fetch API)                         |
| **Armazenamento**   | Arquivos Excel (`.xlsx`), CSV (previsões), pickle (cache)       

## Estrutura do Projeto

```text
├── css/
│   └── style.css                  # Estilos principais da aplicação
├── js/
│   └── script.js                  # Lógica do frontend (carregamento, gráficos, estatísticas)
├── data/
│   ├── TX_tuberculose_00_23.xlsx
│   ├── TX_hepatite_00_23.xlsx
│   ├── TX_hiv_aids_00_23.xlsx
│   ├── TX_hanseniase_00_23.xlsx
│   ├── TX_sifilis_00_23.xlsx
│   ├── Indice_PPC_SP.xlsx
│   ├── Umid_SP.xlsx
│   ├── Urban_SP.xlsx
│   ├── Precipitacao_SP.xlsx
│   ├── Pop_Geral_SP.xlsx
│   ├── Evapot_SP.xlsx
│   ├── Dens_demog_SP.xlsx
│   ├── Temp_Max_SP.xlsx
│   └── Temp_Min_SP.xlsx
├── data/prophet/
│   └── <doença>/<codMunicipio>/forecast_<codMunicipio>_<doença>.csv
├── data/for_model/
│   ├── df_base_TX_hanseniase_00_23.csv
│   ├── df_base_TX_hepatite_00_23.csv
│   ├── df_base_TX_hiv_aids_00_23.csv
│   ├── df_base_TX_sifilis_00_23.csv
│   └── df_base_TX_tuberculose_00_23.csv
|
├── prophet_train_forecast.py      # Script de treinamento e forecast com Prophet
├── index.html                      # Página principal
└── README.md                       # Este arquivo
```

---

## Pré-requisitos

- Python 3.9+
- Bibliotecas Python:
  ```bash
  pip install pandas prophet openpyxl
  ```
- Servidor web para servir arquivos estáticos (ex.: **Live Server** no VSCode ou `python -m http.server`).
- Navegador moderno (Chrome, Firefox, Edge) com suporte a ES6 e Chart.js.
- Chart.js e XLSX.js incluídos no `index.html` via CDN ou localmente.

---

## Instalação

1. Clone o repositório:

```bash
git clone https://github.com/luscaassz/dashboard_diseases.git
cd dashboard_diseases
```

2. Inicie o servidor web local ou entre direto no link do repositorio:

```bash
python -m http.server 8000
```

ou 

```bash
https://luscaassz.github.io/dashboard_diseases/
```

# Execução do Pipeline

1. **XGBoost (Batch)**
```bash
  python predict_xgb_all_cities.py --input_dir data/for_model --outdir results/xgboost
  ```
- Para cada doença e município, treina XGBoost, gera previsões, métricas (metrics.json) e 7 gráficos.
- Salva summary_metrics.csv com desempenho geral.

2. **Prophet – Treino e Previsão (até 2035)**
```bash
  python prophet_train_forecast.py
  ```
- Usa regressores (população, clima, etc.) e gera previsões futuras (até 2035-12-01).
- Saída: data/prophet/<doenca>/<cod_mun>/forecast_*.csv.

3. **Prophet – Gerar histórico completo + previsão ajustada**
```bash
  python prophet_history.py
  ```
- Cria history.csv contendo ds, y_true, y_pred, yhat_lower, yhat_upper para todo o período (histórico + futuro).
- Saída: results/prophet/<doenca>/<cod_mun>/history.csv.

4. **Calcular métricas do Prophet**
```bash
  python prophet_metrics.py --input_dir results/prophet
  ```
- Lê todos os history.csv, calcula MAE, RMSE, R² e salva metrics.json na mesma pasta do município.
- Gera summary_metrics_prophet.csv com resumo.
   
# Executar Dashboard Web
O dashboard é uma aplicação estática (HTML/JS) que carrega dados diretamente dos arquivos Excel e CSVs. Basta servir os arquivos com qualquer servidor HTTP.

## Uso do Dashboard
- Selecione Tipo de Variável (Doenças ou Socioambientais).
- Escolha uma doença/variável.
- Defina o período de interesse (2000–2023).
- Digite o nome do município na busca e selecione.
- Clique em Gerar Gráfico.
- Para ativar previsões futuras (apenas doenças), clique em Previsão – os dados serão carregados do Prophet e exibidos no gráfico.
- Com a previsão ativa, clique em Baixar Previsões para obter um arquivo Excel ou CSV.

**Exemplo do Dashboard para análise de Tuberculose em períodos passados:**

<img width="1261" height="830" alt="image" src="https://github.com/user-attachments/assets/aac7cb89-1491-4b74-9dd8-c4e31321c8ce" />

**Exemplo do Dashboard com a opção de previsão ativada:**

<img width="823" height="697" alt="image" src="https://github.com/user-attachments/assets/155453d2-2749-48a7-84a7-d89b289bab8d" />

# Autor
Lucas Vieira dos Santos Souza – [GitHub](https://github.com/luscaassz) – [LinkedIn](https://www.linkedin.com/in/lucas-vieira-dos-santos-souza-45a613305)


