// -----------------------------
// Variáveis globais
// -----------------------------
// Armazena os dados lidos de arquivos (indexado por chave: nome da doença ou variável socioambiental)
let dadosCarregados = {};
// Lista de municípios atualmente mostrada (preenchida a partir do último dataset carregado)
let municipios = [];
// Instância do chart (Chart.js) atual — usada para destruir/atualizar o gráfico
let chart = null;
// Cópia completa de todos os municípios do dataset carregado (usada para buscas/filtragem)
let todosMunicipios = [];

// -----------------------------
// Mapeamento de doenças para arquivos (caminhos relativos)
// -----------------------------
const arquivosDoencas = {
    tuberculose: 'data/TX_tuberculose_00_23.xlsx',
    hepatite: 'data/TX_hepatite_00_23.xlsx',
    hiv: 'data/TX_hiv_aids_00_23.xlsx',
    hanseniase: 'data/TX_hanseniase_00_23.xlsx',
    sifilis: 'data/TX_sifilis_00_23.xlsx'
};

// --------- CONFIGURAÇÃO DE ARQUIVOS SOCIOAMBIENTAIS (adicionadas novas variáveis) ----------
// Mapeamento de variáveis socioambientais para seus arquivos correspondentes
const arquivosSocio = {
    indice_ppc: 'data/Indice_PPC_SP.xlsx',
    umidade: 'data/Umid_SP.xlsx',
    urbanizacao: 'data/Urban_SP.xlsx',
    precipitacao: 'data/Precip_SP.xlsx',
    populacao: 'data/Pop_Geral_SP.xlsx',
    evapot: 'data/Evapot_SP.xlsx',
    densidade: 'data/Dens_demog_SP.xlsx',
    temp_max: 'data/Temp_Max_SP.xlsx', 
    temp_min: 'data/Temp_Min_SP.xlsx'  
};

// Rótulos amigáveis/legíveis para as variáveis socioambientais (usados na UI e legendas)
const nomesSocio = {
    indice_ppc: 'Índice do Poder da População (PPC)',
    umidade: 'Umidade',
    urbanizacao: 'Urbanização',
    precipitacao: 'Precipitação',
    populacao: 'População (Geral)',
    evapot: 'Evapotranspiração de Referência',
    densidade: 'Densidade Demográfica',
    temp_max: 'Temperatura Máxima',
    temp_min: 'Temperatura Mínima'
};

// Offset para interpretar colunas específicas de densidade que possuem sufixo numérico (por ex. DS_POP_00 -> ano 2000)
const densidadeYearOffset = 2000;

// Mapeamento de abreviações de meses em PT para número do mês (usado por parseDataColuna)
const mesesMap = {
    'Jan': '01', 'Fev': '02', 'Mar': '03', 'Abr': '04', 'Mai': '05', 'Jun': '06',
    'Jul': '07', 'Ago': '08', 'Set': '09', 'Out': '10', 'Nov': '11', 'Dez': '12'
};

// -----------------------------
// Funções utilitárias para mensagens e loading na UI
// -----------------------------
function mostrarMensagem(texto, tipo = 'error') {
    // Exibe mensagem no elemento #mensagem com estilo indicado por "tipo"
    // tipo pode ser 'error', 'success', 'info', etc. (styles dependem do CSS do projeto)
    const mensagem = document.getElementById('mensagem');
    mensagem.textContent = texto;
    mensagem.style.display = 'block';
    mensagem.className = tipo;
    // se for sucesso, esconde automaticamente após 3 segundos
    if (tipo === 'success') setTimeout(() => { mensagem.style.display = 'none'; }, 3000);
}
function ocultarMensagem() { document.getElementById('mensagem').style.display = 'none'; }
function mostrarLoading(){ document.getElementById('loadingIndicator').style.display = 'flex'; }
function ocultarLoading(){ document.getElementById('loadingIndicator').style.display = 'none'; }

/**
 * parseDataColuna: converte textos de cabeçalhos de coluna em objetos Date
 *
 * Suporta vários formatos que os arquivos Excel podem conter:
 * - "YYYY/MonAbrev"  -> ex: "2000/Jan" ou "2000/Jan." (abreviações PT previstas em mesesMap)
 * - "YYYY"           -> ex: "2000" (ano inteiro)
 * - "MM-YYYY" ou "MM-YYYY." -> ex: "01-1999." (alguns arquivos mensais)
 * - "DS_POP_00" (ou similar DS_*_00) -> extrai o sufixo numérico e soma densidadeYearOffset
 * - "PREFIX_YY" onde YY é 2 dígitos -> heurística: assume 2000 + YY
 *
 * Retorna:
 * - Date (assumindo dia 1 do mês quando aplicável)
 * - null se não reconhecido
 */
function parseDataColuna(dataStr) {
    if (!dataStr) return null;
    dataStr = String(dataStr).trim();

    // Formato com barra (ex: "2000/Jan" ou "2000/Jan.")
    if (dataStr.includes('/')) {
        const [anoRaw, mesAbrevRaw] = dataStr.split('/').map(s => s.trim());
        const ano = parseInt(anoRaw);
        // remove trailing dots (ex: "Jan.")
        const mesAbrev = mesAbrevRaw.replace(/\.+$/,'');
        // tenta mapear a abreviação inteira ou os primeiros 3 caracteres
        const mesNum = mesesMap[mesAbrev] || mesesMap[mesAbrev.substring(0,3)];
        if (!isNaN(ano) && mesNum) return new Date(ano, parseInt(mesNum,10) - 1, 1);
    }

    // Formato apenas ano (ex: "2000")
    if (/^\d{4}$/.test(dataStr)) {
        const ano = parseInt(dataStr, 10);
        return new Date(ano, 0, 1);
    }

    // Formato mês-ano (ex: "01-1999", "01-1999.")
    if (dataStr.includes('-')) {
        const clean = dataStr.replace(/\.+$/,''); // remove ponto final se existir
        const parts = clean.split('-').map(s => s.trim());
        if (parts.length === 2) {
            const mes = parseInt(parts[0],10);
            const ano = parseInt(parts[1],10);
            if (!isNaN(mes) && !isNaN(ano)) return new Date(ano, mes - 1, 1);
        }
    }

    // Formato tipo DS_POP_00 ou DS_POP_23 (duas dígitos no final)
    // Regex tenta capturar sufixo numérico de 2 dígitos no final de strings que contêm DS ou POP
    const dsMatch = dataStr.match(/(?:DS[_-]?POP[_-]?|DS[_-]?POP|DS[_-]?)(\d{2})$/i);
    if (dsMatch) {
        const idx = parseInt(dsMatch[1], 10);
        if (!isNaN(idx)) {
            const ano = densidadeYearOffset + idx;
            return new Date(ano, 0, 1); // assume anual (janeiro do ano)
        }
    }

    // Formato genérico com sufixo numérico (ex: SOME_PREFIX_99 ou PREFIX99)
    // Captura final numérico de 2 a 4 dígitos
    const genericMatch = dataStr.match(/(\d{2,4})$/);
    if (genericMatch) {
        const num = genericMatch[1];
        if (num.length === 4) {
            // se for 4 dígitos, assume ano completo
            const ano = parseInt(num,10);
            if (!isNaN(ano)) return new Date(ano, 0, 1);
        } else if (num.length === 2) {
            // heurística: 2 dígitos -> 2000 + num (útil para sufixos como _00 => 2000)
            const ano = 2000 + parseInt(num,10);
            return new Date(ano, 0, 1);
        }
    }

    // se não casou com nenhum padrão conhecido, retorna null (cabeçalho não é uma data reconhecível)
    return null;
}

/**
 * processarValor: normaliza uma célula lida do Excel para um número ou null
 * - aceita números (retorna direto)
 * - aceita strings com vírgula decimal (converte para ponto)
 * - valores vazios ou não numéricos -> null
 */
function processarValor(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'string') {
        // substitui vírgula por ponto, tenta parseFloat
        const num = parseFloat(valor.replace(',', '.'));
        return isNaN(num) ? null : num;
    }
    return null;
}

/* ----------------------- CARREGAR DOENÇAS (mantive sua lógica) -----------------------
   Esta função carrega um arquivo Excel para a doença selecionada, converte a planilha
   para array com header=1 (matriz) e constrói um array de objetos municipio:
   { codMun, codSus, nome, dados: { headerData1: valor, headerData2: valor, ... } }
   Também armazena o resultado em dadosCarregados para evitar recarregamentos.
*/
async function carregarDadosDoenca(doenca) {
    mostrarLoading();
    ocultarMensagem();
    try {
        // Se já carregado em memória, reaproveita e processa
        if (dadosCarregados[doenca]) {
            processarDadosCarregados(dadosCarregados[doenca], doenca);
            ocultarLoading(); return;
        }

        // busca o arquivo via fetch (espera que o servidor sirva os xlsx em /data)
        const resposta = await fetch(arquivosDoencas[doenca]);
        if (!resposta.ok) throw new Error(`Erro ao carregar arquivo: ${resposta.status}`);

        // lê como arrayBuffer e usa XLSX (SheetJS) para interpretar
        const arrayBuffer = await resposta.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const primeiraPlanilha = workbook.Sheets[workbook.SheetNames[0]];
        // sheet_to_json com header:1 retorna matriz (linha por linha) preservando cabeçalho
        const dados = XLSX.utils.sheet_to_json(primeiraPlanilha, { header: 1 });

        const cabecalhos = dados[0];
        // identifica colunas que parecem datas (contêm / ou são anos de 4 dígitos ou contêm '-')
        const colunasDatas = cabecalhos.filter(h => typeof h === 'string' && (h.includes('/') || /^\d{4}$/.test(String(h)) || String(h).includes('-')));
        const dadosMunicipios = [];

        // A leitura assume: coluna 0 = código município, 1 = código SUS, 2 = nome, e a seguir os valores.
        for (let i = 1; i < dados.length; i++) {
            const linha = dados[i];
            if (!linha || linha.length < 3) continue; // pula linhas incompletas
            const municipio = {
                codMun: linha[0] ? linha[0].toString() : '',
                codSus: linha[1] ? linha[1].toString() : '',
                nome: linha[2] ? linha[2].toString() : '',
                dados: {}
            };
            // para cada coluna de data identificada, pega o valor correspondente na linha
            colunasDatas.forEach((data, idx) => {
                const colIndex = 3 + idx;
                municipio.dados[data] = colIndex < linha.length ? processarValor(linha[colIndex]) : null;
            });
            dadosMunicipios.push(municipio);
        }

        // salva cache e processa para popular UI
        dadosCarregados[doenca] = { colunasDatas, dadosMunicipios };
        processarDadosCarregados(dadosCarregados[doenca], doenca);
        ocultarLoading();
    } catch (erro) {
        console.error('Erro ao carregar dados:', erro);
        mostrarMensagem(`Erro ao carregar dados: ${erro.message}.`, 'error');
        ocultarLoading();
    }
}

/* ----------------------- CARREGAR VARIÁVEIS SOCIOAMBIENTAIS -----------------------
   Função mais robusta que tenta detectar automaticamente quais colunas são código/nome
   do município e a partir de qual coluna começam as datas/valores. Fornece heurísticas
   de fallback para nomes ausentes.
*/
async function carregarDadosSocio(chave) {
    mostrarLoading();
    ocultarMensagem();
    try {
        if (dadosCarregados[chave]) {
            processarDadosCarregados(dadosCarregados[chave], chave);
            ocultarLoading(); return;
        }

        const arquivo = arquivosSocio[chave];
        if (!arquivo) throw new Error('Arquivo não configurado para a variável socioambiental.');

        const resposta = await fetch(arquivo);
        if (!resposta.ok) throw new Error(`Erro ao carregar arquivo: ${resposta.status}`);

        const arrayBuffer = await resposta.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const primeiraPlanilha = workbook.Sheets[workbook.SheetNames[0]];
        const dados = XLSX.utils.sheet_to_json(primeiraPlanilha, { header: 1 });

        if (!dados || dados.length < 1) throw new Error('Planilha vazia ou formato inesperado.');

        // normaliza cabeçalhos como strings
        const cabecalhos = dados[0].map(h => h ? String(h).trim() : '');
        // Detecta índices de coluna prováveis para código e nome do município
        const idxCd = cabecalhos.findIndex(h => /cd[_\s]*mun/i.test(h) || /cd[_\s]*m\b/i.test(h));
        const idxMun = cabecalhos.findIndex(h => /\bMUN\b/i.test(h) || /MUNICIPIO/i.test(h) || /NOME/i.test(h) || /\bMUN\w*/i.test(h));

        // Descobre a partir de qual coluna começam as datas: primeiro índice que não é cd nem mun
        let startCol = 0;
        for (let k = 0; k < cabecalhos.length; k++) {
            if (k !== idxCd && k !== idxMun) { startCol = k; break; }
        }
        // fallback se o loop não encontrou (garante ao menos começar na coluna 2)
        if (startCol === 0) startCol = Math.max(2, startCol);

        const colunasDatas = cabecalhos.slice(startCol);
        const dadosMunicipios = [];

        // itera linhas (a partir da segunda) e tenta extrair codMun e nome com heurísticas
        for (let r = 1; r < dados.length; r++) {
            const linha = dados[r];
            if (!linha) continue;

            const codMunRaw = (idxCd >= 0 && idxCd < linha.length) ? linha[idxCd] : '';
            const nomeMunRaw = (idxMun >= 0 && idxMun < linha.length) ? linha[idxMun] : '';

            const codMun = codMunRaw !== undefined && codMunRaw !== null ? String(codMunRaw).trim() : '';
            let nomeMun = nomeMunRaw !== undefined && nomeMunRaw !== null ? String(nomeMunRaw).trim() : '';

            // Se nomeMun estiver vazio ou igual ao código, tenta heurística: busca primeira coluna com texto legível
            if (!nomeMun || nomeMun === codMun) {
                for (let c = 0; c < linha.length; c++) {
                    if (c === idxCd) continue; // pular coluna do código
                    const cell = linha[c];
                    if (cell === undefined || cell === null) continue;
                    const s = String(cell).trim();
                    // heurística: nome plausível contém letras (inclui acentos) e tem comprimento > 2 e não é igual ao código
                    if (/[A-Za-zÀ-ÿ]/.test(s) && s.length > 2 && s !== codMun) {
                        nomeMun = s;
                        break;
                    }
                }
            }

            // Se ainda não encontrou, tenta primeira célula como candidato
            if (!nomeMun && linha[0] !== undefined && linha[0] !== null) {
                const cand = String(linha[0]).trim();
                if (/[A-Za-zÀ-ÿ]/.test(cand) && cand.length > 2 && cand !== codMun) nomeMun = cand;
            }

            // Se ambos vazios, ignora linha
            if (!codMun && !nomeMun) continue;

            // Constrói objeto município e preenche dados das colunas de datas
            const municipio = { codMun: codMun || '', codSus: '', nome: nomeMun || '', dados: {} };
            colunasDatas.forEach((header, j) => {
                const colIndex = startCol + j;
                const rawVal = colIndex < linha.length ? linha[colIndex] : null;
                municipio.dados[header] = processarValor(rawVal);
            });
            dadosMunicipios.push(municipio);
        }

        dadosCarregados[chave] = { colunasDatas, dadosMunicipios };
        processarDadosCarregados(dadosCarregados[chave], chave);
        ocultarLoading();
    } catch (erro) {
        console.error('Erro ao carregar dados socioambientais:', erro);
        mostrarMensagem(`Erro ao carregar dados: ${erro.message}.`, 'error');
        ocultarLoading();
    }
}

/* ----------------------- Processar e popular select de municípios -----------------------
   Recebe os dados já extraídos (colunas e array de municípios) e:
   - atualiza variáveis globais (municipios, todosMunicipios)
   - ordena por nome e popula o <select id="municipio"> com as primeiras 100 opções
   - adiciona mensagem de sucesso contextual ao usuário
*/
function processarDadosCarregados(dados, chave) {
    municipios = dados.dadosMunicipios;
    todosMunicipios = [...municipios];
    const selectMunicipio = document.getElementById('municipio');
    selectMunicipio.innerHTML = '';
    // ordenação alfabética por nome (tratando valores nulos)
    municipios.sort((a,b) => (a.nome||'').localeCompare(b.nome||''));
    // opção padrão
    const defaultOption = document.createElement('option');
    defaultOption.value = ''; defaultOption.textContent = 'Selecione um município';
    selectMunicipio.appendChild(defaultOption);
    // popula até 100 municípios para evitar DOM gigantesco; mais instrução é adicionada se houver >100
    municipios.slice(0,100).forEach(mun => {
        const option = document.createElement('option');
        option.value = mun.codMun;
        // se não houver nome, mostra apenas o código; caso contrário mostra "Nome (Código)"
        if (mun.nome && String(mun.nome).trim() !== '') {
            option.textContent = `${mun.nome} (${mun.codMun})`;
        } else {
            option.textContent = `${mun.codMun}`;
        }
        option.setAttribute('data-nome', mun.nome || '');
        selectMunicipio.appendChild(option);
    });
    if (municipios.length > 100) {
        const maisOption = document.createElement('option');
        maisOption.textContent = `... e mais ${municipios.length - 100} municípios. Use a busca para encontrá-los.`;
        maisOption.disabled = true;
        selectMunicipio.appendChild(maisOption);
    }

    // Mensagem de sucesso contextualizada (usa nomesSocio para labels amigáveis se for variável socioambiental)
    const tipo = document.getElementById('tipoVariavel').value;
    if (tipo === 'doencas') {
        mostrarMensagem(`Dados de ${chave} (doença) carregados. ${municipios.length} municípios encontrados.`, 'success');
    } else {
        const nomeVar = nomesSocio[chave] || chave;
        mostrarMensagem(`Dados de ${nomeVar} carregados. ${municipios.length} municípios encontrados.`, 'success');
    }
}


/* ----------------------- Filtrar Municípios (busca no select) -----------------------
   Lida com input de busca (#municipioSearch) e repovoa o select com resultados.
   - se termo vazio: mostra os primeiros 100 municípios (mesma lógica que processarDadosCarregados)
   - se termo presente: filtra por nome (case-insensitive) ou código
*/
function filtrarMunicipios() {
    const termo = document.getElementById('municipioSearch').value.toLowerCase();
    const selectMunicipio = document.getElementById('municipio');
    selectMunicipio.innerHTML = '';
    const lista = termo === '' ? todosMunicipios.slice(0,100) : todosMunicipios.filter(m =>
        (m.nome||'').toLowerCase().includes(termo) || (m.codMun||'').includes(termo)
    );
    if (lista.length === 0) {
        const option = document.createElement('option');
        option.textContent = 'Nenhum município encontrado';
        option.disabled = true;
        selectMunicipio.appendChild(option);
    } else {
        lista.forEach(mun => {
            const option = document.createElement('option');
            option.value = mun.codMun;
            option.textContent = `${mun.nome} (${mun.codMun})`;
            option.setAttribute('data-nome', mun.nome);
            selectMunicipio.appendChild(option);
        });
    }
}

/* ----------------------- Estatísticas (funções auxiliares e painel) ----------------------- */
// calcula média (populacional)
function calcularMedia(arr){ if(!arr.length) return 0; return arr.reduce((s,v)=>s+v,0)/arr.length; }
// calcula mediana
function calcularMediana(arr){
    if(!arr.length) return 0;
    const s = [...arr].sort((a,b)=>a-b);
    const m = Math.floor(s.length/2);
    return s.length%2===0 ? (s[m-1]+s[m])/2 : s[m];
}
// desvio padrão populacional (divide por N)
function calcularDesvioPadrao(arr){
    if(!arr.length) return 0;
    const m = calcularMedia(arr);
    const soma = arr.reduce((s,v)=>s+Math.pow(v-m,2),0);
    const variancia = soma / arr.length; // populacional
    return Math.sqrt(variancia);
}

// Atualiza painel de estatísticas para uma única série
function atualizarEstatisticas(dadosFiltrados, nomeMunicipio, nomeDoenca) {
    const statsPanel = document.getElementById('statsPanel');
    if (!dadosFiltrados || dadosFiltrados.length === 0) {
        statsPanel.style.display = 'none'; statsPanel.innerHTML = ''; return;
    }
    const valores = dadosFiltrados.map(d=>d.y).filter(v=>v!==null && !isNaN(v));
    if (valores.length === 0) { statsPanel.style.display = 'none'; statsPanel.innerHTML = ''; return; }

    const media = calcularMedia(valores);
    const mediana = calcularMediana(valores);
    const desvio = calcularDesvioPadrao(valores);

    // formata números para pt-BR com 4 casas decimais
    const format = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

    statsPanel.innerHTML = `
        <div class="stat-item">
            <span class="label">Série</span>
            <span class="value">${nomeDoenca} — ${nomeMunicipio}</span>
        </div>
        <div class="stat-item">
            <span class="label">Média</span>
            <span class="value">${format(media)}</span>
        </div>
        <div class="stat-item">
            <span class="label">Mediana</span>
            <span class="value">${format(mediana)}</span>
        </div>
        <div class="stat-item">
            <span class="label">Desvio Padrão (pop.)</span>
            <span class="value">${format(desvio)}</span>
        </div>
    `;
    statsPanel.style.display = 'flex';
}

// Atualiza painel quando existem múltiplas séries (cada série vira um card)
function atualizarEstatisticasMultiplas(seriesArray, nomeMunicipio) {
    const statsPanel = document.getElementById('statsPanel');
    if (!seriesArray || seriesArray.length === 0) {
        statsPanel.style.display = 'none';
        statsPanel.innerHTML = '';
        return;
    }

    // Re-declara funções locais para isolamento (poderia reutilizar as globais)
    const calcularMedia = arr => arr.length ? arr.reduce((s,v)=>s+v,0)/arr.length : 0;
    const calcularMediana = arr => {
        if (!arr.length) return 0;
        const s = [...arr].sort((a,b)=>a-b);
        const m = Math.floor(s.length/2);
        return s.length%2===0 ? (s[m-1]+s[m])/2 : s[m];
    };
    const calcularDesvioPadrao = arr => {
        if (!arr.length) return 0;
        const m = calcularMedia(arr);
        const soma = arr.reduce((s,v)=>s+Math.pow(v-m,2),0);
        const variancia = soma / arr.length;
        return Math.sqrt(variancia);
    };
    const formatNum = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

    // Monta HTML dos cards
    let html = `<div style="display:flex; gap:12px; width:100%; flex-wrap:wrap; align-items:flex-start;">`;

    seriesArray.forEach(series => {
        const valores = (series.data || []).map(d => d.y).filter(v => v !== null && !isNaN(v));
        if (valores.length === 0) {
            html += `
                <div class="stat-item" style="min-width:180px;">
                    <span class="label">${series.label}</span>
                    <div class="value" style="font-size:14px; margin-top:6px;">Sem dados</div>
                </div>`;
            return;
        }
        const media = calcularMedia(valores);
        const mediana = calcularMediana(valores);
        const desvio = calcularDesvioPadrao(valores);

        html += `
            <div style="min-width:200px; padding:10px; border-radius:8px; background:#fff; box-shadow:0 2px 8px rgba(0,0,0,0.06); flex:1 1 220px;">
                <div style="font-weight:700; color:var(--secondary-color); margin-bottom:8px;">${series.label}</div>
                <div style="display:flex; flex-direction:column; gap:8px;">
                    <div><span style="font-weight:700;">Média:</span> <span style="margin-left:6px; font-weight:600;">${formatNum(media)}</span></div>
                    <div><span style="font-weight:700;">Mediana:</span> <span style="margin-left:6px; font-weight:600;">${formatNum(mediana)}</span></div>
                    <div><span style="font-weight:700;">Desvio Padrão (pop.):</span> <span style="margin-left:6px; font-weight:600;">${formatNum(desvio)}</span></div>
                    <div style="margin-top:6px; color:#6b7280; font-size:13px;">N = ${valores.length}</div>
                </div>
            </div>`;
    });

    html += `</div>`;

    // título do painel (mostrando município)
    statsPanel.innerHTML = `
        <div style="width:100%; margin-bottom:8px; font-weight:700; color:var(--secondary-color);">
            Estatísticas — ${nomeMunicipio}
        </div>
        ${html}
    `;
    statsPanel.style.display = 'flex';
}

/* ----------------------- Gerar Gráfico (unificado para doenças e socio) -----------------------
   - Lê parâmetros da UI (tipo, variável selecionada, município, intervalo de datas)
   - Prepara séries (montarSerie) convertendo os cabeçalhos para Date via parseDataColuna
   - Suporta variável combinada 'temperaturas' (plota temp_max e temp_min juntas)
   - Decide se o chart será 'line' (múltiplas séries) ou 'scatter' (apenas pontos)
   - Configura Chart.js: escala temporal no eixo X, tooltip customizado
   - Se apenas uma série: chama atualização de estatísticas e adiciona previsões (se ativas)
*/
function gerarGrafico() {
    const tipo = document.getElementById('tipoVariavel').value;
    const variavelSelecionada = document.getElementById('doenca').value; // ex: 'tuberculose' ou 'temperaturas' ou 'temp_max'
    const codMunicipio = document.getElementById('municipio').value;
    const dataInicioInput = document.getElementById('dataInicio').value;
    const dataFimInput = document.getElementById('dataFim').value;
    const dataInicio = dataInicioInput ? new Date(dataInicioInput) : null;
    const dataFim = dataFimInput ? new Date(dataFimInput) : null;

    // Para o combo de temperaturas, certifique-se que ambos datasets foram carregados
    if (variavelSelecionada === 'temperaturas') {
        if (!dadosCarregados['temp_max'] || !dadosCarregados['temp_min']) {
            mostrarMensagem('Por favor, aguarde os dados de temperatura serem carregados.');
            return;
        }
    } else {
        if (!dadosCarregados[variavelSelecionada]) { mostrarMensagem('Por favor, aguarde os dados serem carregados.'); return; }
    }

    // validações básicas da UI
    if (!codMunicipio) { mostrarMensagem('Por favor, selecione um município.'); return; }
    if (dataInicio && dataFim && dataInicio > dataFim) { mostrarMensagem('A data de início deve ser anterior à data de fim.'); return; }

    // Seleciona o município a partir do último dataset carregado (todosMunicipios foi preenchido pelo último load)
    const municipio = todosMunicipios.find(m => m.codMun === codMunicipio);
    if (!municipio) { mostrarMensagem('Município não encontrado.'); return; }

    // Função auxiliar para converter objeto municipio (com .dados: {header:valor}) em série [{x:Date,y:val},...]
    const montarSerie = (munObj, filtroDatas) => {
        const arr = [];
        Object.entries(munObj.dados).forEach(([dataStr, valor]) => {
            const data = parseDataColuna(dataStr); // converte header em Date
            if (!data) return; // ignora cabeçalhos não reconhecidos
            // aplica filtro de intervalo, se fornecido
            if (filtroDatas && filtroDatas.start && data < filtroDatas.start) return;
            if (filtroDatas && filtroDatas.end && data > filtroDatas.end) return;
            if (valor === null || valor === undefined) return; // ignora missing
            arr.push({ x: data, y: valor });
        });
        // ordena por data ascendentes
        arr.sort((a,b)=>a.x-b.x);
        return arr;
    };

    const filtroDatas = { start: dataInicio, end: dataFim };

    let datasetsToPlot = [];

    if (variavelSelecionada === 'temperaturas') {
        // Caso especial: combina temp_max e temp_min
        const maxDataObj = (dadosCarregados['temp_max'] || {}).dadosMunicipios || [];
        const minDataObj = (dadosCarregados['temp_min'] || {}).dadosMunicipios || [];

        const maxMun = maxDataObj.find(m => m.codMun === codMunicipio);
        const minMun = minDataObj.find(m => m.codMun === codMunicipio);

        if (!maxMun && !minMun) {
            mostrarMensagem('Município não encontrado nos arquivos de temperatura.');
            return;
        }

        if (maxMun) {
            const serieMax = montarSerie(maxMun, filtroDatas);
            datasetsToPlot.push({
                label: `${nomesSocio['temp_max'] || 'Temp Máx'} — ${maxMun.nome || maxMun.codMun}`,
                data: serieMax,
                fill: false,
                tension: 0.2,
                borderWidth: 2,
                pointRadius: 3,
                backgroundColor: 'rgba(220,20,60,0.9)', // vermelho-ish
                borderColor: 'rgba(220,20,60,0.9)'
            });
        }

        if (minMun) {
            const serieMin = montarSerie(minMun, filtroDatas);
            datasetsToPlot.push({
                label: `${nomesSocio['temp_min'] || 'Temp Mín'} — ${minMun.nome || minMun.codMun}`,
                data: serieMin,
                fill: false,
                tension: 0.2,
                borderWidth: 2,
                pointRadius: 3,
                backgroundColor: 'rgba(30,144,255,0.9)', // azul-ish
                borderColor: 'rgba(30,144,255,0.9)'
            });
        }

    } else {
        // Caso padrão: uma única série (doença ou variável socioambiental individual)
        const datasetInfo = dadosCarregados[variavelSelecionada];
        if (!datasetInfo) { mostrarMensagem('Dados não disponíveis.'); return; }
        const muniList = datasetInfo.dadosMunicipios || [];
        const munObj = muniList.find(m => m.codMun === codMunicipio);
        if (!munObj) { mostrarMensagem('Município não encontrado no dataset selecionado.'); return; }
        const serie = montarSerie(munObj, filtroDatas);

        datasetsToPlot.push({
            label: `${variavelSelecionada} — ${munObj.nome || munObj.codMun}`,
            data: serie,
            pointRadius: 6,
            pointHoverRadius: 8,
            pointBorderWidth: 2,
            showLine: false, // manter como pontos (scatter-like)
            backgroundColor: 'rgb(75, 192, 192)',
            borderColor: 'rgb(16,115,115)'
        });
    }

    // Se nenhuma série tem dados
    const totalPoints = datasetsToPlot.reduce((s, ds) => s + (ds.data ? ds.data.length : 0), 0);
    if (totalPoints === 0) {
        mostrarMensagem('Não há dados disponíveis para o período selecionado.');
        if (chart) { chart.destroy(); chart = null; }
        atualizarEstatisticas([], '', '');
        return;
    }

    ocultarMensagem();
    const ctx = document.getElementById('graficoDoenca').getContext('2d');

    // Se já existe um chart, destrói antes de criar novo (limpeza)
    if (chart) {
        try { chart.destroy(); } catch(e){ console.warn('Erro ao destruir chart:', e); }
        chart = null;
    }
    ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);

    // decidir tipo do chart: se múltiplas séries -> usar 'line', se única -> scatter (pontos)
    const usarLine = datasetsToPlot.length > 1;

    // Ajustes de dataset para Chart.js (quando usando line, queremos showLine true)
    const finalDatasets = datasetsToPlot.map(ds => {
        if (usarLine) {
            return {
                ...ds,
                showLine: true,
                spanGaps: true
            };
        } else {
            return ds;
        }
    });

    // Criação do gráfico (Chart.js) com configuração de tempo no eixo X
    chart = new Chart(ctx, {
        type: usarLine ? 'line' : 'scatter',
        data: { datasets: finalDatasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'month', tooltipFormat: 'MMM/yyyy' },
                    title: { display: true, text: 'Data' }
                },
                y: {
                    title: { display: true, text: 'Valor' },
                    beginAtZero: false
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: (variavelSelecionada === 'temperaturas') ? `Temperaturas — ${municipio.nome}` : `${variavelSelecionada} — ${municipio.nome}`,
                    font: { size: 18 }
                },
                tooltip: {
                    callbacks: {
                        // Personaliza o texto do tooltip usando context.raw que contém {x:Date,y:valor}
                        label: function(context) {
                            const raw = context.raw;
                            const dsLabel = context.dataset && context.dataset.label ? context.dataset.label.split(' — ')[0] : '';
                            const dataFormatada = new Date(raw.x).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
                            return `${dsLabel}: ${raw.y !== null ? raw.y.toFixed(4) : 'N/A'} (${dataFormatada})`;
                        }
                    }
                },
                legend: { position: 'top' }
            }
        }
    });

    // Atualizar estatísticas:
    // - Se apenas uma série -> usa atualizarEstatisticasComPrevisao (mostra histórico + previsões opcionais)
    // - Se várias séries -> usar atualizarEstatisticasMultiplas para mostrar colunas separadas
    if (datasetsToPlot.length === 1) {
        atualizarEstatisticasComPrevisao(
            datasetsToPlot[0].data, 
            dadosPrevisao, 
            municipio.nome, 
            datasetsToPlot[0].label
        );
        
        // MODIFICAÇÃO IMPORTANTE: Adicionar previsões APÓS criar o gráfico
        // Aguarda um tick (setTimeout) para garantir que o gráfico foi renderizado antes de adicionar datasets de previsão.
        setTimeout(() => {
            if (previsaoAtiva && dadosPrevisao && tipo === 'doencas') {
                adicionarPrevisoesAoGrafico(dadosPrevisao, chart);
            }
        }, 100);
        
    } else {
        // estatísticas separadas por série (mantém o original)
        const seriesForStats = datasetsToPlot.map(ds => {
            const shortLabel = (ds.label && ds.label.includes('—')) ? ds.label.split('—')[0].trim() : ds.label;
            return { label: shortLabel, data: ds.data || [] };
        });
        atualizarEstatisticasMultiplas(seriesForStats, municipio.nome);
    }
}


/* ----------------------- Controle do select de tipo de variável e opções -----------------------
   Preenche o select #doenca de acordo com o tipo ('doencas' ou 'socioambiental').
   - Em 'doencas': adiciona opções fixas em ordem definida
   - Em socioambientais: adiciona opção combinada 'temperaturas' e depois cada variável individual
   - Também dispara carregamento do dataset apropriado após seleção
*/
function popularSelectParaTipo(tipo) {
    const select = document.getElementById('doenca');
    select.innerHTML = '';
    if (tipo === 'doencas') {
        const ordem = ['tuberculose','hepatite','hiv','hanseniase','sifilis'];
        ordem.forEach(k => {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = (() => {
                switch(k){
                    case 'tuberculose': return 'Tuberculose';
                    case 'hepatite': return 'Hepatite';
                    case 'hiv': return 'HIV/AIDS';
                    case 'hanseniase': return 'Hanseníase';
                    case 'sifilis': return 'Sífilis';
                    default: return k;
                }
            })();
            select.appendChild(opt);
        });
        const chaveAtual = select.value;
        if (chaveAtual) carregarDadosDoenca(chaveAtual);
    } else {
        // socioambientais: popula todas as variáveis + opção combinada "temperaturas"
        // primeiro a opção combinada
        const optCombo = document.createElement('option');
        optCombo.value = 'temperaturas';
        optCombo.textContent = 'Temperaturas (Máx + Mín)';
        select.appendChild(optCombo);

        // depois as variáveis individuais (usa nomesSocio para labels amigáveis)
        Object.entries(nomesSocio).forEach(([k,label]) => {
            const opt = document.createElement('option');
            opt.value = k;
            opt.textContent = label;
            select.appendChild(opt);
        });

        const chaveAtual = select.value || 'temperaturas';
        select.value = chaveAtual;
        // carregar dados: se combo, carregamos ambos; se individual, carregamos aquele
        if (chaveAtual === 'temperaturas') {
            // dispara carregamento dos dois arquivos de temperatura (eles ficam em dadosCarregados separadamente)
            carregarDadosSocio('temp_max');
            carregarDadosSocio('temp_min');
        } else {
            carregarDadosSocio(chaveAtual);
        }
    }
}

// ==================== FUNÇÕES DE PREVISÃO ====================

// Variáveis globais para controle de previsões
let previsaoAtiva = false;
let dadosPrevisao = null;

// Mapeamento de nomes de doenças para pasta/arquivo de previsão (ajusta nomes esperados no path)
const mapeamentoPrevisaoDoencas = {
    'tuberculose': 'tuberculose',
    'hepatite': 'hepatite',
    'hiv': 'hiv_aids', 
    'hanseniase': 'hanseniase',
    'sifilis': 'sifilis'
};

/*
 * carregarDadosPrevisao:
 * - espera que exista um CSV pré-calculado pela pipeline de forecast (ex: Prophet)
 * - caminho: data/prophet/<nomeDoencaArquivo>/<codMunicipio>/forecast_<codMunicipio>_<nomeDoencaArquivo>.csv
 * - lê CSV simples (separado por vírgula), converte para array de objetos e retorna lista com:
 *   { data: Date, previsao: yhat (float), limiteInferior: yhat_lower, limiteSuperior: yhat_upper, valorReal: actual|null }
 */
async function carregarDadosPrevisao(codMunicipio, doenca) {
    const botaoPrevisao = document.getElementById('botaoPrevisao');
    
    try {
        // Mostrar estado de carregamento no botão
        botaoPrevisao.classList.add('loading');
        botaoPrevisao.textContent = 'Carregando...';
        
        const nomeDoencaArquivo = mapeamentoPrevisaoDoencas[doenca];
        if (!nomeDoencaArquivo) {
            throw new Error('Previsão não disponível para esta doença');
        }
        
        const caminhoArquivo = `data/prophet/${nomeDoencaArquivo}/${codMunicipio}/forecast_${codMunicipio}_${nomeDoencaArquivo}.csv`;
        
        console.log(`Carregando previsão: ${caminhoArquivo}`);
        
        const resposta = await fetch(caminhoArquivo);
        
        if (!resposta.ok) {
            throw new Error(`Arquivo de previsão não encontrado (${resposta.status})`);
        }
        
        const csvText = await resposta.text();
        // divide em linhas e remove linhas vazias
        const linhas = csvText.split('\n').filter(linha => linha.trim() !== '');
        
        if (linhas.length <= 1) {
            throw new Error('Arquivo de previsão vazio');
        }
        
        // Processar CSV: primeira linha = cabeçalhos
        const cabecalhos = linhas[0].split(',');
        const dadosProcessados = [];
        
        for (let i = 1; i < linhas.length; i++) {
            const valores = linhas[i].split(',');
            const registro = {};
            
            cabecalhos.forEach((cabecalho, index) => {
                registro[cabecalho] = valores[index];
            });
            
            dadosProcessados.push(registro);
        }
        
        // Converter para formato interno (Date e floats)
        const previsaoFormatada = dadosProcessados.map(item => ({
            data: new Date(item.ds),
            previsao: parseFloat(item.yhat) || 0,
            limiteInferior: parseFloat(item.yhat_lower) || 0,
            limiteSuperior: parseFloat(item.yhat_upper) || 0,
            valorReal: item.actual ? parseFloat(item.actual) : null
        }));
        
        console.log(`Previsão carregada: ${previsaoFormatada.length} registros`);
        
        return previsaoFormatada;
        
    } catch (erro) {
        console.error('Erro ao carregar previsão:', erro);
        throw erro;
    } finally {
        // Restaurar botão ao estado correto (ativo ou não)
        botaoPrevisao.classList.remove('loading');
        botaoPrevisao.textContent = previsaoAtiva ? 'Remover Previsão' : 'Previsão';
    }
}

/*
 * adicionarPrevisoesAoGrafico:
 * - Recebe uma lista de previsões (dadosPrevisao) no formato retornado por carregarDadosPrevisao()
 * - Filtra apenas pontos futuros (valorReal === null) e adiciona 3 datasets no chart:
 *   1) Limite Inferior (linha pontilhada)
 *   2) Limite Superior (linha pontilhada + preenchimento entre limites)
 *   3) Previsão principal (yhat) (linha sólida)
 * - Atualiza chart (chart.update())
 */
function adicionarPrevisoesAoGrafico(dadosPrevisao, chart) {
    if (!chart || !dadosPrevisao) return;
    
    // Filtrar apenas dados futuros (onde valorReal é null)
    const dadosFuturos = dadosPrevisao.filter(item => item.valorReal === null);
    
    if (dadosFuturos.length === 0) {
        mostrarMensagem('Nenhum dado futuro encontrado na previsão', 'error');
        return;
    }
    
    console.log(`Adicionando ${dadosFuturos.length} pontos de previsão ao gráfico`);
    
    // Dataset do limite inferior (yhat_lower) - linha pontilhada fina
    chart.data.datasets.push({
        label: 'Limite Inferior',
        data: dadosFuturos.map(item => ({
            x: item.data,
            y: item.limiteInferior
        })),
        borderColor: 'rgba(0, 55, 255, 0.6)', // cor para linha inferior
        backgroundColor: 'rgba(231, 76, 60, 0.1)',
        borderWidth: 4,
        pointRadius: 0, // Sem pontos
        pointHoverRadius: 0,
        borderDash: [5, 5], // Linha pontilhada
        fill: false,
        tension: 0.3,
        showLine: true // Forçar mostrar linha (útil se chart for scatter)
    });
    
    // Dataset do limite superior (yhat_upper) - linha pontilhada fina e preenchimento entre limites
    chart.data.datasets.push({
        label: 'Limite Superior',
        data: dadosFuturos.map(item => ({
            x: item.data,
            y: item.limiteSuperior
        })),
        borderColor: 'rgba(231, 76, 60, 0.6)', // cor para linha superior
        backgroundColor: 'rgba(231, 76, 60, 0.1)',
        borderWidth: 4,
        pointRadius: 0, // Sem pontos
        pointHoverRadius: 0,
        borderDash: [5, 5], // Linha pontilhada
        fill: '+1', // Preencher área entre este dataset e o anterior (assume ordem)
        tension: 0.3,
        showLine: true // Forçar mostrar linha
    });
    
    // Dataset da previsão principal (yhat) - linha contínua fina
    chart.data.datasets.push({
        label: 'Previsão',
        data: dadosFuturos.map(item => ({
            x: item.data,
            y: item.previsao
        })),
        borderColor: '#00ff00ff', // cor da linha de previsão (aqui definida literal)
        backgroundColor: 'rgba(231, 76, 60, 0.1)',
        borderWidth: 4, // largura da linha
        pointRadius: 2, // Pontos pequenos para previsão
        pointHoverRadius: 4,
        pointBackgroundColor: '#00ff33ff',
        pointBorderColor: '#ffffff',
        pointBorderWidth: 1,
        borderDash: [], // Linha sólida
        fill: false,
        tension: 0.3,
        showLine: true // Forçar mostrar linha
    });
    
    // Atualiza o gráfico para renderizar os novos datasets
    chart.update();
    
    console.log('Previsões adicionadas ao gráfico:', chart.data.datasets.length, 'datasets');
}

/* Função para remover previsões do gráfico:
   - Assume que sempre foram adicionados 3 datasets de previsão (inferior, superior, previsão)
   - Remove os 3 últimos datasets do chart.data.datasets
*/
function removerPrevisoesDoGrafico(chart) {
    if (!chart) return;
    
    // Contar quantos datasets de previsão existem (sempre 3: inferior, superior, previsão)
    const totalDatasets = chart.data.datasets.length;
    const datasetsOriginais = chart.data.datasets.slice(0, totalDatasets - 3);
    chart.data.datasets = datasetsOriginais;
    chart.update();
    
    console.log('Previsões removidas do gráfico');
}

/* ----------------------- togglePrevisao (controle por botão) -----------------------
   - Valida seleção de município e doença
   - Se previsão não ativa: chama carregarDadosPrevisao e adiciona ao gráfico
   - Se já ativa: remove previsões e reseta estado
*/
async function togglePrevisao() {
    const codMunicipio = document.getElementById('municipio').value;
    const doenca = document.getElementById('doenca').value;
    const botaoPrevisao = document.getElementById('botaoPrevisao');
    
    // Verificar se é uma variável de doença (previsões só para doenças)
    const tipoVariavel = document.getElementById('tipoVariavel').value;
    if (tipoVariavel !== 'doencas') {
        mostrarMensagem('Previsões disponíveis apenas para variáveis de doenças', 'error');
        return;
    }
    
    if (!codMunicipio || !doenca) {
        mostrarMensagem('Selecione um município e uma doença primeiro', 'error');
        return;
    }
    
    if (!previsaoAtiva) {
        // Ativar previsão
        try {
            mostrarMensagem('Carregando previsão...', 'info');
            
            const previsaoCarregada = await carregarDadosPrevisao(codMunicipio, doenca);
            
            if (previsaoCarregada) {
                dadosPrevisao = previsaoCarregada;
                previsaoAtiva = true;
                botaoPrevisao.classList.add('active');
                botaoPrevisao.textContent = 'Remover Previsão';
                
                // Adicionar previsões ao gráfico atual
                if (chart) {
                    adicionarPrevisoesAoGrafico(dadosPrevisao, chart);
                    mostrarMensagem('Previsão carregada com sucesso', 'success');
                }
            }
        } catch (erro) {
            mostrarMensagem(`Erro: ${erro.message}`, 'error');
        }
    } else {
        // Desativar previsão: limpa estado e remove do gráfico
        previsaoAtiva = false;
        dadosPrevisao = null;
        botaoPrevisao.classList.remove('active');
        botaoPrevisao.textContent = 'Previsão';
        
        // Remover previsões do gráfico
        if (chart) {
            removerPrevisoesDoGrafico(chart);
            mostrarMensagem('Previsão removida', 'success');
        }
    }
}

/* ----------------------- Estatísticas com Previsões -----------------------
   - atualiza painel de estatísticas incluindo métricas para previsões futuras (se ativadas)
   - recebe:
 * dadosFiltrados: array de histórico [{x:Date,y:valor},...]
 * dadosPrevisao: array retornado por carregarDadosPrevisao()
 * nomeMunicipio, nomeDoenca: strings para exibição
*/
function atualizarEstatisticasComPrevisao(dadosFiltrados, dadosPrevisao, nomeMunicipio, nomeDoenca) {
    const statsPanel = document.getElementById('statsPanel');
    
    if (!dadosFiltrados || dadosFiltrados.length === 0) {
        statsPanel.style.display = 'none';
        statsPanel.innerHTML = '';
        return;
    }
    
    // Calcular estatísticas dos dados históricos
    const valoresHistoricos = dadosFiltrados.map(d => d.y).filter(v => v !== null && !isNaN(v));
    
    if (valoresHistoricos.length === 0) {
        statsPanel.style.display = 'none';
        statsPanel.innerHTML = '';
        return;
    }
    
    const media = calcularMedia(valoresHistoricos);
    const mediana = calcularMediana(valoresHistoricos);
    const desvio = calcularDesvioPadrao(valoresHistoricos);
    
    const format = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 4, maximumFractionDigits: 4 });
    
    let html = `
        <div class="stat-item">
            <span class="label">Série</span>
            <span class="value">${nomeDoenca} — ${nomeMunicipio}</span>
        </div>
        <div class="stat-item">
            <span class="label">Média (Histórico)</span>
            <span class="value">${format(media)}</span>
        </div>
        <div class="stat-item">
            <span class="label">Mediana (Histórico)</span>
            <span class="value">${format(mediana)}</span>
        </div>
        <div class="stat-item">
            <span class="label">Desvio Padrão (Histórico)</span>
            <span class="value">${format(desvio)}</span>
        </div>
    `;
    
    // Adicionar estatísticas da previsão se disponível
    if (previsaoAtiva && dadosPrevisao) {
        const previsoesFuturas = dadosPrevisao.filter(item => item.valorReal === null);
        const valoresPrevisao = previsoesFuturas.map(item => item.previsao);
        
        if (valoresPrevisao.length > 0) {
            const mediaPrevisao = calcularMedia(valoresPrevisao);
            const medianaPrevisao = calcularMediana(valoresPrevisao);
            const desvioPrevisao = calcularDesvioPadrao(valoresPrevisao);
            
            html += `
                <div class="stat-item" style="border-top: 2px solid #e74c3c; padding-top: 10px; margin-top: 10px;">
                    <span class="label" style="color: #e74c3c; font-weight: 700;">Média (Previsão)</span>
                    <span class="value" style="color: #e74c3c; font-weight: 700;">${format(mediaPrevisao)}</span>
                </div>
                <div class="stat-item">
                    <span class="label" style="color: #e74c3c; font-weight: 700;">Mediana (Previsão)</span>
                    <span class="value" style="color: #e74c3c; font-weight: 700;">${format(medianaPrevisao)}</span>
                </div>
                <div class="stat-item">
                    <span class="label" style="color: #e74c3c; font-weight: 700;">Desvio Padrão (Previsão)</span>
                    <span class="value" style="color: #e74c3c; font-weight: 700;">${format(desvioPrevisao)}</span>
                </div>
            `;
        }
    }

    statsPanel.innerHTML = html;
    statsPanel.style.display = 'flex';
}

/* ----------------------- Event listeners (ligação à interface) -----------------------
   Add event listeners para os controles da página:
   - mudança no tipo (doencas / socio)
   - mudança de variável (dispara carregamento)
   - input de busca de município
   - clique botão gerar gráfico
   - carregamento inicial (DOMContentLoaded): popula selects e carrega doença inicial
   - botão de previsão e listeners que resetam previsões quando seleção muda
*/
document.getElementById('tipoVariavel').addEventListener('change', function(){
    popularSelectParaTipo(this.value);
});

document.getElementById('doenca').addEventListener('change', function(){
    const tipo = document.getElementById('tipoVariavel').value;
    if (tipo === 'doencas') {
        carregarDadosDoenca(this.value);
    } else {
        carregarDadosSocio(this.value);
    }
});
document.getElementById('municipioSearch').addEventListener('input', filtrarMunicipios);
document.getElementById('gerarGrafico').addEventListener('click', gerarGrafico);

document.addEventListener('DOMContentLoaded', function(){
    // popula inicialmente (doenças)
    popularSelectParaTipo('doencas');
    const doencaInicial = document.getElementById('doenca').value;
    carregarDadosDoenca(doencaInicial);
});

document.getElementById('botaoPrevisao').addEventListener('click', togglePrevisao);

// Resetar previsões quando mudar município ou doença (para evitar mostrar previsões erradas)
document.getElementById('municipio').addEventListener('change', function() {
    if (previsaoAtiva) {
        resetarPrevisao();
    }
});

document.getElementById('doenca').addEventListener('change', function() {
    if (previsaoAtiva) {
        resetarPrevisao();
    }
});

document.getElementById('tipoVariavel').addEventListener('change', function() {
    if (previsaoAtiva) {
        resetarPrevisao();
    }
});

// Função para resetar previsão (limpa estado e remove do gráfico)
function resetarPrevisao() {
    previsaoAtiva = false;
    dadosPrevisao = null;
    const botaoPrevisao = document.getElementById('botaoPrevisao');
    botaoPrevisao.classList.remove('active');
    botaoPrevisao.textContent = 'Previsão';
    
    if (chart) {
        removerPrevisoesDoGrafico(chart);
    }
}
