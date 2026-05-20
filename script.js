document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('form-manutencao');
    const campoDataManutencao = document.getElementById('data_manutencao');
    if(campoDataManutencao) campoDataManutencao.value = new Date().toISOString().split('T')[0];

    // ⚠️ SUA URL DO GOOGLE APPS SCRIPT
    const URL_DA_SUA_PLANILHA = "https://script.google.com/macros/s/AKfycbwnuj2wVx0GsPgVwYShWAJbE69sI6oEyrc_lvhGZ9hfsu_yepOt2RyT5rUcob6HstyRWw/exec";

    // Automação de Endereços por Cliente Fixos
    const selectCliente = document.getElementById('cliente');
    const inputEndereco = document.getElementById('endereco');
    const enderecosClientes = {
        'MATRIZ': 'Rua Desembargador Leite Albuquerque, 1320 - Aldeota',
        'LIFE': 'Rua Coronel Linhares, 1143 - Aldeota',
        'SUL': 'Rua Virgilio Paes, 3020 - Cidades dos Funcionários'
    };

    if (selectCliente) {
        selectCliente.addEventListener('change', (e) => {
            const clienteSelecionado = e.target.value;
            if (enderecosClientes[clienteSelecionado] && inputEndereco) {
                inputEndereco.value = enderecosClientes[clienteSelecionado];
            }
        });
    }

    // Gerenciador de Arquivos local (Fotos/Vídeos)
    let listaDeArquivosJson = [];
    const inputMidia = document.getElementById('arquivos_midia');
    const galeriaPreview = document.getElementById('galeria-preview');

    if (inputMidia) {
        inputMidia.addEventListener('change', (e) => {
            Array.from(e.target.files).forEach(file => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = () => {
                    listaDeArquivosJson.push({
                        base64: reader.result,
                        type: file.type
                    });

                    const box = document.createElement('div');
                    box.classList.add('item-midia-preview');
                    
                    if (file.type.startsWith('image/')) {
                        const img = document.createElement('img');
                        img.src = reader.result;
                        box.appendChild(img);
                    } else {
                        const vid = document.createElement('video');
                        vid.src = reader.result;
                        box.appendChild(vid);
                    }
                    
                    const btnDel = document.createElement('button');
                    btnDel.innerHTML = '✕';
                    btnDel.classList.add('btn-remover-midia');
                    btnDel.type = 'button';
                    btnDel.onclick = () => {
                        listaDeArquivosJson = listaDeArquivosJson.filter(item => item.base64 !== reader.result);
                        box.remove();
                    };
                    box.appendChild(btnDel);
                    if (galeriaPreview) galeriaPreview.appendChild(box);
                };
            });
            inputMidia.value = '';
        });
    }

    // Digitação por voz
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.lang = 'pt-BR';
        let elementoDestino = null;
        let botaoAtivo = null;

        document.querySelectorAll('.btn-voice').forEach(botao => {
            botao.addEventListener('click', () => {
                elementoDestino = document.getElementById(botao.getAttribute('data-target'));
                botaoAtivo = botao;
                try { recognition.start(); } catch (e) { recognition.stop(); }
            });
        });

        recognition.onstart = () => { if (botaoAtivo) { botaoAtivo.classList.add('listening'); botaoAtivo.innerText = "🛑"; } };
        recognition.onresult = (event) => { if (elementoDestino) elementoDestino.value += (elementoDestino.value ? ' ' : '') + event.results[0][0].transcript; };
        recognition.onend = () => { if (botaoAtivo) { botaoAtivo.classList.remove('listening'); botaoAtivo.innerText = "🎙️"; } };
    }

    // Envio unificado e robusto
    if (form) {
        form.addEventListener('submit', function(event) {
            event.preventDefault();

            // Validação visual rápida antes de enviar
            let valido = true;
            form.querySelectorAll('.input-group').forEach(group => {
                const inputs = group.querySelectorAll('input, textarea, select');
                if (inputs.length > 0) {
                    let preenchido = true;
                    if (inputs[0].type === 'radio') {
                        const name = inputs[0].name;
                        if (!group.querySelector(`input[name="${name}"]:checked`)) preenchido = false;
                    } else if (!inputs[0].checkValidity()) {
                        preenchido = false;
                    }
                    if (!preenchido) { group.classList.add('invalid'); valido = false; } 
                    else { group.classList.remove('invalid'); }
                }
            });

            if (!valido) { alert('Por favor, preencha todos os campos obrigatórios marcados com (*).'); return; }

            const btnFinalizar = document.getElementById('btn-finalizar');
            if (btnFinalizar) {
                btnFinalizar.innerText = "Enviando dados e mídias... ⏳";
                btnFinalizar.disabled = true;
            }

            // Captura direta usando seletores de ID para evitar falha de Name no HTML
            const radioEquipamento = document.querySelector('input[name="tipo_equipamento"]:checked');
            const radioManutencao = document.querySelector('input[name="tipo_manutencao"]:checked');
            const radioStatus = document.querySelector('input[name="status_servico"]:checked');

            const dadosParaEnvio = new URLSearchParams();
            dadosParaEnvio.append('cliente', document.getElementById('cliente').value);
            dadosParaEnvio.append('localizacao_interna', document.getElementById('localizacao_aparelho').value);
            dadosParaEnvio.append('endereco', document.getElementById('endereco').value);
            dadosParaEnvio.append('tipo_equipamento', radioEquipamento ? radioEquipamento.value : 'Não informado');
            dadosParaEnvio.append('marca', document.getElementById('marca').value);
            dadosParaEnvio.append('modelo', document.getElementById('modelo').value);
            dadosParaEnvio.append('numero_serie', document.getElementById('numero_serie').value);
            dadosParaEnvio.append('data_manutencao', campoDataManutencao ? campoDataManutencao.value : '');
            dadosParaEnvio.append('tipo_manutencao', radioManutencao ? radioManutencao.value : 'Não informado');
            dadosParaEnvio.append('descricao_problema', document.getElementById('descricao_problema').value);
            dadosParaEnvio.append('acoes_realizadas', document.getElementById('acoes_realizadas').value);
            dadosParaEnvio.append('pecas_substituidas', document.getElementById('pecas_substituidas').value || "Nenhuma");
            dadosParaEnvio.append('status_servico', radioStatus ? radioStatus.value : 'Pendente');
            dadosParaEnvio.append('parecer_final', document.getElementById('parecer_final').value);
            
            // Tratamento das Mídias
            dadosParaEnvio.append('num_arquivos', listaDeArquivosJson.length);
            listaDeArquivosJson.forEach((arquivo, index) => {
                dadosParaEnvio.append('arquivo_' + index, arquivo.base64);
                dadosParaEnvio.append('tipo_' + index, arquivo.type);
            });

            // Requisição com content-type explícito
            fetch(URL_DA_SUA_PLANILHA, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: dadosParaEnvio.toString()
            })
            .then(() => {
                alert('Sucesso absoluto! Dados e mídias salvos na planilha.');
                form.reset();
                if(campoDataManutencao) campoDataManutencao.value = new Date().toISOString().split('T')[0];
                if(galeriaPreview) galeriaPreview.innerHTML = '';
                listaDeArquivosJson = [];
            })
            .catch(erro => {
                console.error('Erro de rede:', erro);
                alert('Erro de comunicação. Verifique a internet.');
            })
            .finally(() => {
                if (btnFinalizar) {
                    btnFinalizar.innerText = "Finalizar e Alimentar Planilha";
                    btnFinalizar.disabled = false;
                }
            });
        });
    }
});