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

## Instalação e Execução

1. Clone o repositório:

```bash
git clone https://github.com/luscaassz/dashboard_diseases.git
cd dashboard_diseases
```

2. Inicie o servidor web local:

```bash
python -m http.server 8000
```

3. Abra no navegador:

```
http://localhost:8000
```

4. Para gerar previsões com Prophet (opcional):

```bash
python prophet_train_forecast.py
```

Os CSVs de forecast serão salvos em `data/prophet/<doença>/<codMunicipio>/`.

---

## Uso

1. Selecione o tipo de variável: **Doenças** ou **Socioambiental**.
2. Escolha a doença ou variável desejada.
3. Selecione o município na lista ou busque pelo nome/código.
4. Defina o intervalo de datas desejado.
5. Clique em **Gerar Gráfico**.
6. Para exibir previsões (se disponíveis), clique em **Previsão**.

O painel de estatísticas será atualizado automaticamente com média, mediana e desvio padrão.

---

## Descrição dos Scripts

### `js/script.js`

- **Variáveis globais**: armazenam dados carregados, lista de municípios, gráfico ativo.
- **Funções de carregamento**: `carregarDadosDoenca()`, `carregarDadosSocio()` leem arquivos Excel via SheetJS.
- **Funções utilitárias**: parse de datas, normalização de valores.
- **Gerenciamento de gráficos**: `gerarGrafico()`, `montarSerie()`.
- **Estatísticas**: cálculo de média, mediana, desvio padrão populacional.
- **Previsão**: `carregarDadosPrevisao()` e `adicionarPrevisoesAoGrafico()` adicionam séries de forecast ao gráfico.

### `prophet_train_forecast.py`

- Lê séries temporais de doenças de cada município.
- Treina modelos Prophet para previsão futura.
- Salva CSVs em `data/prophet/<doença>/<codMunicipio>/forecast_<codMunicipio>_<doença>.csv`.
- Estrutura de saída compatível com `script.js` para plotagem automática.

---

## Previsão com Prophet

- **Formato CSV esperado**:

```csv
ds,yhat,yhat_lower,yhat_upper,actual
2023-01-01,15.2,12.1,18.3,14
2023-02-01,16.1,13.0,19.2,15
...
```

- `ds`: data (YYYY-MM-DD)
- `yhat`: previsão central
- `yhat_lower` e `yhat_upper`: limites de confiança
- `actual`: valor real (opcional, pode ser nulo para previsões futuras)

O frontend carrega e plota automaticamente, gerando linhas para previsão, limite inferior e superior.

---

