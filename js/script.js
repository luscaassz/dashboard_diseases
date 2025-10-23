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

// Mapeamento de meses
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

function parseDataColuna(dataStr) {
    if (!dataStr || !dataStr.includes('/')) return null;
    const [ano, mesAbrev] = dataStr.split('/');
    if (!mesesMap[mesAbrev]) return null;
    return new Date(parseInt(ano), parseInt(mesesMap[mesAbrev]) - 1, 1);
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
        const colunasDatas = cabecalhos.filter(h => typeof h === 'string' && h.includes('/'));
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

function processarDadosCarregados(dados, doenca) {
    municipios = dados.dadosMunicipios;
    todosMunicipios = [...municipios];
    const selectMunicipio = document.getElementById('municipio');
    selectMunicipio.innerHTML = '';
    municipios.sort((a,b) => a.nome.localeCompare(b.nome));
    const defaultOption = document.createElement('option');
    defaultOption.value = ''; defaultOption.textContent = 'Selecione um município';
    selectMunicipio.appendChild(defaultOption);
    municipios.slice(0,100).forEach(mun => {
        const option = document.createElement('option');
        option.value = mun.codMun;
        option.textContent = `${mun.nome} (${mun.codMun})`;
        option.setAttribute('data-nome', mun.nome);
        selectMunicipio.appendChild(option);
    });
    if (municipios.length > 100) {
        const maisOption = document.createElement('option');
        maisOption.textContent = `... e mais ${municipios.length - 100} municípios. Use a busca para encontrá-los.`;
        maisOption.disabled = true;
        selectMunicipio.appendChild(maisOption);
    }
    mostrarMensagem(`Dados de ${doenca} carregados. ${municipios.length} municípios encontrados.`, 'success');
}

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

// Estatísticas
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

function gerarGrafico() {
    const doenca = document.getElementById('doenca').value;
    const codMunicipio = document.getElementById('municipio').value;
    const dataInicioInput = document.getElementById('dataInicio').value;
    const dataFimInput = document.getElementById('dataFim').value;
    const dataInicio = dataInicioInput ? new Date(dataInicioInput) : null;
    const dataFim = dataFimInput ? new Date(dataFimInput) : null;

    if (!dadosCarregados[doenca]) { mostrarMensagem('Por favor, aguarde os dados serem carregados.'); return; }
    if (!codMunicipio) { mostrarMensagem('Por favor, selecione um município.'); return; }
    if (dataInicio && dataFim && dataInicio > dataFim) { mostrarMensagem('A data de início deve ser anterior à data de fim.'); return; }

    const municipio = todosMunicipios.find(m => m.codMun === codMunicipio);
    if (!municipio) { mostrarMensagem('Município não encontrado.'); return; }

    const dadosFiltrados = [];
    Object.entries(municipio.dados).forEach(([dataStr, valor]) => {
        const data = parseDataColuna(dataStr);
        if (!data) return;
        if (dataInicio && data < dataInicio) return;
        if (dataFim && data > dataFim) return;
        if (valor === null || valor === undefined) return;
        dadosFiltrados.push({ x: data, y: valor });
    });
    dadosFiltrados.sort((a,b)=>a.x-b.x);

    if (dadosFiltrados.length === 0) {
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

    chart = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [{
                label: `Taxa de ${doenca} em ${municipio.nome}`,
                data: dadosFiltrados,
                backgroundColor: 'rgb(75, 192, 192)',
                borderColor: 'rgb(16,115,115)',  
                pointRadius: 6,
                pointHoverRadius: 8,
                pointBorderWidth: 2,
                pointBorderColor: '#fff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: {
                        unit: 'month',
                        tooltipFormat: 'MMM/yyyy'
                    },
                    title: { display: true, text: 'Data' }
                },
                y: {
                    title: { display: true, text: 'Taxa' },
                    beginAtZero: true
                }
            },
            plugins: {
                title: {
                    display: true,
                    text: `Taxa de ${doenca} em ${municipio.nome}`,
                    font: { size: 18 }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const data = context.raw;
                            const dataFormatada = new Date(data.x).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
                            return `Data: ${dataFormatada}, Taxa: ${data.y !== null ? data.y.toFixed(4) : 'N/A'}`;
                        }
                    }
                },
                legend: { position: 'top' }
            }
        }
    });

    atualizarEstatisticas(dadosFiltrados, municipio.nome, doenca);
}

// Event listeners
document.getElementById('doenca').addEventListener('change', function(){
    document.getElementById('municipio').innerHTML = '<option value="">Carregando...</option>';
    carregarDadosDoenca(this.value);
});
document.getElementById('municipioSearch').addEventListener('input', filtrarMunicipios);
document.getElementById('gerarGrafico').addEventListener('click', gerarGrafico);

document.addEventListener('DOMContentLoaded', function(){
    const doencaInicial = document.getElementById('doenca').value;
    carregarDadosDoenca(doencaInicial);
});
