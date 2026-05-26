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

    // =========================================================================
    // LÓGICA DO CANVAS DE ASSINATURA DIGITAL
    // =========================================================================
    const canvas = document.getElementById('canvas-assinatura');
    const btnLimpar = document.getElementById('btn-limpar-assinatura');
    const inputAssinaturaBase64 = document.getElementById('assinatura_base64');
    const erroAssinatura = document.getElementById('erro-assinatura');
    let desenhando = false;
    let assinaturaDesenhada = false; // Controle de validação do preenchimento

    if (canvas) {
        const ctx = canvas.getContext('2d');
        
        // Ajusta a resolução interna do canvas baseado no tamanho de tela (evita borrão)
        function ajustarResolucaoCanvas() {
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width;
            canvas.height = rect.height;
            // Configurações do traço da caneta
            ctx.strokeStyle = '#000000';
            ctx.lineWidth = 3;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            assinaturaDesenhada = false;
            if(inputAssinaturaBase64) inputAssinaturaBase64.value = '';
        }
        
        ajustarResolucaoCanvas();
        window.addEventListener('resize', ajustarResolucaoCanvas);

        // Função para capturar as coordenadas exatas
        function obterPosicao(e) {
            const rect = canvas.getBoundingClientRect();
            if (e.touches && e.touches.length > 0) {
                return {
                    x: e.touches[0].clientX - rect.left,
                    y: e.touches[0].clientY - rect.top
                };
            }
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        }

        function iniciarDesenho(e) {
            desenhando = true;
            const pos = obterPosicao(e);
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            e.preventDefault();
        }

        function desenhar(e) {
            if (!desenhando) return;
            const pos = obterPosicao(e);
            ctx.lineTo(pos.x, pos.y);
            ctx.stroke();
            assinaturaDesenhada = true; // Confirma que houve interação válida
            if(erroAssinatura) erroAssinatura.style.display = 'none';
            e.preventDefault();
        }

        function pararDesenho() {
            if (desenhando) {
                desenhando = false;
                // Atualiza em tempo real o input oculto com o conteúdo em imagem
                if (assinaturaDesenhada && inputAssinaturaBase64) {
                    inputAssinaturaBase64.value = canvas.toDataURL('image/png');
                }
            }
        }

        // Eventos para Desktop (Mouse)
        canvas.addEventListener('mousedown', iniciarDesenho);
        canvas.addEventListener('mousemove', desenhar);
        window.addEventListener('mouseup', pararDesenho);

        // Eventos para Dispositivos Móveis (Touchscreen)
        canvas.addEventListener('touchstart', iniciarDesenho, { passive: false });
        canvas.addEventListener('touchmove', desenhar, { passive: false });
        canvas.addEventListener('touchend', pararDesenho);

        // Botão para limpar a assinatura do quadro
        if (btnLimpar) {
            btnLimpar.addEventListener('click', () => {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                assinaturaDesenhada = false;
                if(inputAssinaturaBase64) inputAssinaturaBase64.value = '';
            });
        }
    }
    // =========================================================================

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

            // Validação customizada da assinatura digital obrigatória
            if (!assinaturaDesenhada) {
                valido = false;
                if(erroAssinatura) erroAssinatura.style.display = 'block';
                const containerAssinatura = document.querySelector('.signature-container');
                if(containerAssinatura) containerAssinatura.style.borderColor = '#ff4d4d';
            }

            if (!valido) { alert('Por favor, preencha todos os campos obrigatórios marcados com (*) e colha a assinatura.'); return; }

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
            
            // Inclusão da Assinatura no envio para a Planilha
            dadosParaEnvio.append('assinatura_responsavel', inputAssinaturaBase64 ? inputAssinaturaBase64.value : '');

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
                
                // Reseta estados do Canvas pós-envio de sucesso
                if (canvas) {
                    const ctx = canvas.getContext('2d');
                    ctx.clearRect(0, 0, canvas.width, canvas.height);
                }
                assinaturaDesenhada = false;

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
