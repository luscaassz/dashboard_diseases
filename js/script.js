// Variáveis globais
let dadosCarregados = {};
let municipios = [];
let chart = null;
let todosMunicipios = [];

// Mapeamento de doenças para arquivos
const arquivosDoencas = {
    tuberculose: 'data/TX_tuberculose_00_23.xlsx',
    hepatite: 'data/TX_hepatite_00_23.xlsx',
    hiv: 'data/TX_hiv_aids_00_23.xlsx',
    hanseniase: 'data/TX_hanseniase_00_23.xlsx',
    sifilis: 'data/TX_sifilis_00_23.xlsx'
};

// --------- CONFIGURAÇÃO DE ARQUIVOS SOCIOAMBIENTAIS (adicionadas novas variáveis) ----------
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

const densidadeYearOffset = 2000;

// Mapeamento de meses (abreviações PT)
const mesesMap = {
    'Jan': '01', 'Fev': '02', 'Mar': '03', 'Abr': '04', 'Mai': '05', 'Jun': '06',
    'Jul': '07', 'Ago': '08', 'Set': '09', 'Out': '10', 'Nov': '11', 'Dez': '12'
};

function mostrarMensagem(texto, tipo = 'error') {
    const mensagem = document.getElementById('mensagem');
    mensagem.textContent = texto;
    mensagem.style.display = 'block';
    mensagem.className = tipo;
    if (tipo === 'success') setTimeout(() => { mensagem.style.display = 'none'; }, 3000);
}
function ocultarMensagem() { document.getElementById('mensagem').style.display = 'none'; }
function mostrarLoading(){ document.getElementById('loadingIndicator').style.display = 'flex'; }
function ocultarLoading(){ document.getElementById('loadingIndicator').style.display = 'none'; }

/**
 * parseDataColuna: aceita vários formatos encontrados:
 * - "YYYY/MonAbrev"  -> exemplo: "2000/Jan" (ou "2000/Jan" com abreviações PT)
 * - "YYYY"           -> exemplo: "2000" (usado no Indice_PPC)
 * - "MM-YYYY" ou "MM-YYYY." -> exemplo: "01-1999." (Umidade). Trata trailing dot.
 */
/**
 * parseDataColuna: aceita diferentes formatos:
 * - "YYYY"              -> ex: "2000" (anos)
 * - "YYYY/MonAbrev"     -> ex: "2000/Jan" ou "2000/Jan." (mantive por segurança)
 * - "MM-YYYY" ou "MM-YYYY." -> ex: "01-1999."
 * - "DS_POP_00" (ou similar DS_*_00) -> mapeia para densidadeYearOffset + número
 * - "PREFIX_YY" onde YY é 2 dígitos -> heurística: assume offset 2000
 */
function parseDataColuna(dataStr) {
    if (!dataStr) return null;
    dataStr = String(dataStr).trim();

    // Formato com barra (ex: "2000/Jan" ou "2000/Jan.")
    if (dataStr.includes('/')) {
        const [anoRaw, mesAbrevRaw] = dataStr.split('/').map(s => s.trim());
        const ano = parseInt(anoRaw);
        const mesAbrev = mesAbrevRaw.replace(/\.+$/,'');
        const mesNum = mesesMap[mesAbrev] || mesesMap[mesAbrev.substring(0,3)]; // tenta abrev com 3 letras
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
    const dsMatch = dataStr.match(/(?:DS[_-]?POP[_-]?|DS[_-]?POP|DS[_-]?)(\d{2})$/i);
    if (dsMatch) {
        const idx = parseInt(dsMatch[1], 10);
        if (!isNaN(idx)) {
            const ano = densidadeYearOffset + idx;
            return new Date(ano, 0, 1); // assume anual (janeiro do ano)
        }
    }

    // Formato genérico com sufixo numérico (ex: SOME_PREFIX_99 ou PREFIX99)
    const genericMatch = dataStr.match(/(\d{2,4})$/);
    if (genericMatch) {
        const num = genericMatch[1];
        if (num.length === 4) {
            // se for 4 dígitos, assume ano
            const ano = parseInt(num,10);
            if (!isNaN(ano)) return new Date(ano, 0, 1);
        } else if (num.length === 2) {
            // se for 2 dígitos, assume 2000 + num (heurística)
            const ano = 2000 + parseInt(num,10);
            return new Date(ano, 0, 1);
        }
    }

    // se não casou, retorna null
    return null;
}

function processarValor(valor) {
    if (valor === null || valor === undefined || valor === '') return null;
    if (typeof valor === 'number') return valor;
    if (typeof valor === 'string') {
        const num = parseFloat(valor.replace(',', '.'));
        return isNaN(num) ? null : num;
    }
    return null;
}

/* ----------------------- CARREGAR DOENÇAS (mantive sua lógica) ----------------------- */
async function carregarDadosDoenca(doenca) {
    mostrarLoading();
    ocultarMensagem();
    try {
        if (dadosCarregados[doenca]) {
            processarDadosCarregados(dadosCarregados[doenca], doenca);
            ocultarLoading(); return;
        }

        const resposta = await fetch(arquivosDoencas[doenca]);
        if (!resposta.ok) throw new Error(`Erro ao carregar arquivo: ${resposta.status}`);

        const arrayBuffer = await resposta.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });
        const primeiraPlanilha = workbook.Sheets[workbook.SheetNames[0]];
        const dados = XLSX.utils.sheet_to_json(primeiraPlanilha, { header: 1 });

        const cabecalhos = dados[0];
        const colunasDatas = cabecalhos.filter(h => typeof h === 'string' && (h.includes('/') || /^\d{4}$/.test(String(h)) || String(h).includes('-')));
        const dadosMunicipios = [];

        for (let i = 1; i < dados.length; i++) {
            const linha = dados[i];
            if (!linha || linha.length < 3) continue;
            const municipio = {
                codMun: linha[0] ? linha[0].toString() : '',
                codSus: linha[1] ? linha[1].toString() : '',
                nome: linha[2] ? linha[2].toString() : '',
                dados: {}
            };
            colunasDatas.forEach((data, idx) => {
                const colIndex = 3 + idx;
                municipio.dados[data] = colIndex < linha.length ? processarValor(linha[colIndex]) : null;
            });
            dadosMunicipios.push(municipio);
        }

        dadosCarregados[doenca] = { colunasDatas, dadosMunicipios };
        processarDadosCarregados(dadosCarregados[doenca], doenca);
        ocultarLoading();
    } catch (erro) {
        console.error('Erro ao carregar dados:', erro);
        mostrarMensagem(`Erro ao carregar dados: ${erro.message}.`, 'error');
        ocultarLoading();
    }
}

/* ----------------------- CARREGAR VARIÁVEIS SOCIOAMBIENTAIS (melhorado com fallback de nome) ----------------------- */
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

        const cabecalhos = dados[0].map(h => h ? String(h).trim() : '');
        // detectar colunas de código e nome (nomes possíveis: CD_MUN, CD_M, MUN, MUN_NAME, etc.)
        const idxCd = cabecalhos.findIndex(h => /cd[_\s]*mun/i.test(h) || /cd[_\s]*m\b/i.test(h));
        const idxMun = cabecalhos.findIndex(h => /\bMUN\b/i.test(h) || /MUNICIPIO/i.test(h) || /NOME/i.test(h) || /\bMUN\w*/i.test(h));

        // descobrir a partir de qual coluna começam as datas (o primeiro índice que não é CD_MUN nem MUN)
        let startCol = 0;
        for (let k = 0; k < cabecalhos.length; k++) {
            if (k !== idxCd && k !== idxMun) { startCol = k; break; }
        }
        if (startCol === 0) startCol = Math.max(2, startCol); // fallback razoável

        const colunasDatas = cabecalhos.slice(startCol);
        const dadosMunicipios = [];

        for (let r = 1; r < dados.length; r++) {
            const linha = dados[r];
            if (!linha) continue;

            const codMunRaw = (idxCd >= 0 && idxCd < linha.length) ? linha[idxCd] : '';
            const nomeMunRaw = (idxMun >= 0 && idxMun < linha.length) ? linha[idxMun] : '';

            const codMun = codMunRaw !== undefined && codMunRaw !== null ? String(codMunRaw).trim() : '';
            let nomeMun = nomeMunRaw !== undefined && nomeMunRaw !== null ? String(nomeMunRaw).trim() : '';

            // Fallback: se nomeMun vazio ou igual ao código, tenta encontrar outra coluna com texto
            if (!nomeMun || nomeMun === codMun) {
                for (let c = 0; c < linha.length; c++) {
                    if (c === idxCd) continue; // pular coluna do código
                    const cell = linha[c];
                    if (cell === undefined || cell === null) continue;
                    const s = String(cell).trim();
                    // heurística: nome plausível contém letras (não só dígitos) e tem comprimento significativo
                    if (/[A-Za-zÀ-ÿ]/.test(s) && s.length > 2 && s !== codMun) {
                        nomeMun = s;
                        break;
                    }
                }
            }

            // se ainda não encontrou nome, tentar o primeiro campo (útil quando a ordem é diferente)
            if (!nomeMun && linha[0] !== undefined && linha[0] !== null) {
                const cand = String(linha[0]).trim();
                if (/[A-Za-zÀ-ÿ]/.test(cand) && cand.length > 2 && cand !== codMun) nomeMun = cand;
            }

            // se ambos vazios pular
            if (!codMun && !nomeMun) continue;

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

/* ----------------------- Processar e popular select de municípios (melhor label para option) ----------------------- */
function processarDadosCarregados(dados, chave) {
    municipios = dados.dadosMunicipios;
    todosMunicipios = [...municipios];
    const selectMunicipio = document.getElementById('municipio');
    selectMunicipio.innerHTML = '';
    municipios.sort((a,b) => (a.nome||'').localeCompare(b.nome||''));
    const defaultOption = document.createElement('option');
    defaultOption.value = ''; defaultOption.textContent = 'Selecione um município';
    selectMunicipio.appendChild(defaultOption);
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

    // Mensagem de sucesso contextualizada
    const tipo = document.getElementById('tipoVariavel').value;
    if (tipo === 'doencas') {
        mostrarMensagem(`Dados de ${chave} (doença) carregados. ${municipios.length} municípios encontrados.`, 'success');
    } else {
        const nomeVar = nomesSocio[chave] || chave;
        mostrarMensagem(`Dados de ${nomeVar} carregados. ${municipios.length} municípios encontrados.`, 'success');
    }
}


/* ----------------------- Filtrar Municípios (busca) ----------------------- */
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

/* ----------------------- Estatísticas ----------------------- */
function calcularMedia(arr){ if(!arr.length) return 0; return arr.reduce((s,v)=>s+v,0)/arr.length; }
function calcularMediana(arr){
    if(!arr.length) return 0;
    const s = [...arr].sort((a,b)=>a-b);
    const m = Math.floor(s.length/2);
    return s.length%2===0 ? (s[m-1]+s[m])/2 : s[m];
}
function calcularDesvioPadrao(arr){
    if(!arr.length) return 0;
    const m = calcularMedia(arr);
    const soma = arr.reduce((s,v)=>s+Math.pow(v-m,2),0);
    const variancia = soma / arr.length; // populacional
    return Math.sqrt(variancia);
}

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

function atualizarEstatisticasMultiplas(seriesArray, nomeMunicipio) {
    const statsPanel = document.getElementById('statsPanel');
    if (!seriesArray || seriesArray.length === 0) {
        statsPanel.style.display = 'none';
        statsPanel.innerHTML = '';
        return;
    }

    // Funções auxiliares (reutiliza as que já existem)
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

    // Construir HTML: cada série vira um "card" dentro do painel
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

/* ----------------------- Gerar Gráfico (unificado para doenças e socio) ----------------------- */
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

    if (!codMunicipio) { mostrarMensagem('Por favor, selecione um município.'); return; }
    if (dataInicio && dataFim && dataInicio > dataFim) { mostrarMensagem('A data de início deve ser anterior à data de fim.'); return; }

    // Seleciona o município a partir do dataset carregado (todosMunicipios foi preenchido pelo último load)
    const municipio = todosMunicipios.find(m => m.codMun === codMunicipio);
    if (!municipio) { mostrarMensagem('Município não encontrado.'); return; }

    // Função auxiliar para converter objeto municipio (com .dados) em série [{x:Date,y:val},...]
    const montarSerie = (munObj, filtroDatas) => {
        const arr = [];
        Object.entries(munObj.dados).forEach(([dataStr, valor]) => {
            const data = parseDataColuna(dataStr);
            if (!data) return;
            if (filtroDatas && filtroDatas.start && data < filtroDatas.start) return;
            if (filtroDatas && filtroDatas.end && data > filtroDatas.end) return;
            if (valor === null || valor === undefined) return;
            arr.push({ x: data, y: valor });
        });
        arr.sort((a,b)=>a.x-b.x);
        return arr;
    };

    const filtroDatas = { start: dataInicio, end: dataFim };

    let datasetsToPlot = [];

    if (variavelSelecionada === 'temperaturas') {
        // encontrar o município nos dois datasets (temp_max e temp_min)
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
        // Caso padrão: uma única série; pega municipio a partir do dadosCarregados[variavelSelecionada]
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

    if (chart) {
        try { chart.destroy(); } catch(e){ console.warn('Erro ao destruir chart:', e); }
        chart = null;
    }
    ctx.clearRect(0,0,ctx.canvas.width, ctx.canvas.height);

    // decidir tipo do chart: se múltiplas séries -> usar 'line', se única -> manter comportamento anterior (pontos)
    const usarLine = datasetsToPlot.length > 1;

    // Ajustes de dataset para Chart.js (quando usando line, we want showLine true)
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

    // Atualizar estatísticas: se múltiplas séries, usamos atualizarEstatisticasMultiplas
    if (datasetsToPlot.length === 1) {
        // datasetToPlot[0].data está no formato [{x,y},...]
        atualizarEstatisticas(datasetsToPlot[0].data, municipio.nome, datasetsToPlot[0].label);
    } else {
        // estatísticas separadas por série (cada dataset tem .label e .data)
        // remover possíveis sufixos do label (ex: " — NomeDoMun") para mostrar só o nome da série
        const seriesForStats = datasetsToPlot.map(ds => {
            // manter label curta (usa texto antes de ' — ' se houver)
            const shortLabel = (ds.label && ds.label.includes('—')) ? ds.label.split('—')[0].trim() : ds.label;
            return { label: shortLabel, data: ds.data || [] };
        });
        atualizarEstatisticasMultiplas(seriesForStats, municipio.nome);
    }
}


/* ----------------------- Controle do select de tipo de variável e opções ----------------------- */
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

        // depois as variáveis individuais
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


/* ----------------------- Event listeners ----------------------- */
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
