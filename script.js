document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // URL /exec da implantação ativa do Google Apps Script (código em apps-script/Codigo.gs).
    // Ela é pública por natureza; quem protege a planilha é o CODIGO_ACESSO configurado no Apps Script.
    const API_URL = 'https://script.google.com/macros/s/AKfycbyBqniVF28HJq5_KdaF7n8bIf1r4uXSPY90vAFJu1w7f3R8No0LlUXUl6RHQJ8shUx2Jw/exec';
    const FORM_VERSION = '3';
    const KEYS = { draft: 'formulario_manutencao_v3', profile: 'npc_tecnico_v1', locais: 'npc_locais_v1' };
    const CONFIG = {
        maxFiles: 3,
        // Fotos grandes são aceitas e compactadas antes do envio.
        maxImageSize: 12 * 1024 * 1024,
        // Vídeos não são compactados no navegador; mantê-los pequenos reduz muito o tempo.
        maxVideoSize: 2 * 1024 * 1024,
        maxTotalSize: 5 * 1024 * 1024,
        imageQuality: 0.65,
        imageMaxWidth: 1280,
        imageMaxHeight: 1280,
        minSignatureStrokes: 5,
        requestTimeout: 120000,
        queueRetryInterval: 60000
    };
    const ADDRESSES = {
        MATRIZ: 'Rua Desembargador Leite Albuquerque, 1320 - Aldeota',
        LIFE: 'Rua Coronel Linhares, 1143 - Aldeota',
        SUL: 'Rua Virgilio Paes, 3020 - Cidades dos Funcionários',
        PARQUELANDIA: 'Rua Padre Guerra, 1088 - Parquelandia'
    };
    // Itens do PMOC (Lei 13.589/2018) aplicáveis a splits, janelas e centrais de pequeno porte.
    const CHECKLIST = [
        ['filtros', 'Limpeza / higienização dos filtros de ar'],
        ['evaporadora', 'Limpeza da serpentina e turbina da evaporadora'],
        ['condensadora', 'Limpeza da condensadora (serpentina e hélice)'],
        ['dreno', 'Bandeja e dreno limpos e desobstruídos'],
        ['vazamento_gas', 'Sem sinais de vazamento de gás (óleo nas conexões)'],
        ['isolamento', 'Isolamento térmico das tubulações em bom estado'],
        ['eletrica', 'Conexões elétricas, cabos e disjuntor em bom estado'],
        ['ruido', 'Sem ruídos ou vibrações anormais'],
        ['fixacao', 'Fixação e suportes firmes'],
        ['controle', 'Controle remoto / termostato funcionando']
    ];
    const CHECKLIST_OPTIONS = ['OK', 'Não conforme', 'N/A'];
    const MEASUREMENTS = [
        ['temp_insuflamento', 'Temp. insuflamento', '°C'],
        ['temp_retorno', 'Temp. retorno', '°C'],
        ['corrente', 'Corrente compressor', 'A'],
        ['pressao', 'Pressão de sucção', 'psi']
    ];
    // Parâmetros aceitos no link do QR Code (gerado em etiquetas/index.html).
    const URL_PREFILL = {
        cliente: 'cliente', local: 'localizacao_aparelho', tipo: 'tipo_equipamento', marca: 'marca',
        modelo: 'modelo', serie: 'numero_serie', btus: 'capacidade_btus', gas: 'gas_refrigerante'
    };

    const form = document.getElementById('form-manutencao');
    const $ = (selector) => document.querySelector(selector);
    const fields = {
        client: $('#cliente'), address: $('#endereco'), location: $('#localizacao_aparelho'), locations: $('#lista-locais'),
        date: $('#data_manutencao'), start: $('#hora_inicio'), end: $('#hora_fim'),
        model: $('#modelo'), serial: $('#numero_serie'), technician: $('#tecnico_nome'), accessCode: $('#codigo_acesso'),
        checklist: $('#checklist-pmoc'),
        media: $('#arquivos_midia'), gallery: $('#galeria-preview'), mediaCount: $('#media-count'),
        canvas: $('#canvas-assinatura'), signature: $('#assinatura_base64'), signatureError: $('#erro-assinatura'),
        clearSignature: $('#btn-limpar-assinatura'), submit: $('#btn-finalizar'),
        queueBanner: $('#fila-envio'), queueText: $('#fila-texto'), notice: $('#aviso')
    };
    let media = [];
    let sending = false;
    let flushing = false;
    let strokes = 0;
    let drawing = false;
    let lastFocus = null;
    let noticeTimer = null;
    let knownLocations = {};

    /* ------------------------------------------------------------------ */
    /* Utilitários                                                          */
    /* ------------------------------------------------------------------ */

    const pad = (n) => String(n).padStart(2, '0');
    function localDate() {
        const now = new Date();
        return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    }
    function localTime() {
        const now = new Date();
        return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    }
    function uuid() {
        return crypto.randomUUID?.() || `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    }
    function readJson(key, fallback) {
        try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
    }
    function writeJson(key, value) {
        try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* modo anônimo ou armazenamento cheio */ }
    }
    function removeKey(key) {
        try { localStorage.removeItem(key); } catch { /* ignorar */ }
    }
    function normalize(text) {
        return String(text).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    }
    function humanSize(bytes) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }
    function plural(count, singular, pluralForm) {
        return `${count} ${count === 1 ? singular : pluralForm}`;
    }

    /** Preenche um campo pelo nome (texto, select ou grupo de radios). */
    function setField(name, value) {
        const field = form.elements.namedItem(name);
        if (!field || value == null) return false;
        if (field instanceof RadioNodeList) { field.value = value; return field.value === value; }
        if (field instanceof HTMLSelectElement) {
            if (![...field.options].some((option) => option.value === value)) return false;
            field.value = value;
            return true;
        }
        if (field.type === 'file' || field.type === 'hidden') return false;
        field.value = field.maxLength > 0 ? String(value).slice(0, field.maxLength) : value;
        return true;
    }

    /* ------------------------------------------------------------------ */
    /* Modais e avisos                                                      */
    /* ------------------------------------------------------------------ */

    function setModal(id, visible) {
        const modal = document.getElementById(id);
        if (!modal) return;
        modal.classList.toggle('hidden', !visible);
        if (visible) {
            lastFocus = document.activeElement;
            modal.querySelector('button, [tabindex]')?.focus();
        } else if (lastFocus instanceof HTMLElement) {
            lastFocus.focus();
        }
    }

    function closeModals() {
        ['modal-confirmacao', 'modal-sucesso', 'modal-erro'].forEach((id) => {
            if (!document.getElementById(id).classList.contains('hidden')) setModal(id, false);
        });
    }

    function showError(message, title = 'Não foi possível enviar') {
        $('#titulo-erro').textContent = title;
        $('#modal-erro-mensagem').textContent = message;
        setModal('modal-erro', true);
    }

    function showSuccess(title, message, color = 'var(--success)') {
        const heading = $('#titulo-sucesso');
        heading.textContent = title;
        heading.style.color = color;
        $('#modal-sucesso-mensagem').textContent = message;
        setModal('modal-sucesso', true);
    }

    function showNotice(message, timeout = 8000) {
        clearTimeout(noticeTimer);
        fields.notice.textContent = message;
        fields.notice.classList.remove('hidden');
        if (timeout) noticeTimer = setTimeout(() => fields.notice.classList.add('hidden'), timeout);
    }

    /* ------------------------------------------------------------------ */
    /* Tema claro / escuro                                                  */
    /* ------------------------------------------------------------------ */

    const THEMES = {
        auto: { label: 'Auto', name: 'automático (segue o celular)', icon: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>' },
        light: { label: 'Claro', name: 'claro', icon: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>' },
        dark: { label: 'Escuro', name: 'escuro', icon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>' }
    };
    const THEME_ORDER = ['auto', 'light', 'dark'];

    function applyTheme(theme) {
        if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
        else delete document.documentElement.dataset.theme;
        const info = THEMES[theme] || THEMES.auto;
        const button = $('#btn-tema');
        button.querySelector('svg').innerHTML = info.icon;
        button.querySelector('span').textContent = info.label;
        button.setAttribute('aria-label', `Tema: ${info.name}. Tocar para mudar.`);
        button.title = `Tema ${info.name}`;
    }

    function initTheme() {
        let theme = 'auto';
        try { theme = localStorage.getItem('npc_tema') || 'auto'; } catch { /* ignorar */ }
        applyTheme(theme);
        $('#btn-tema').addEventListener('click', () => {
            const current = document.documentElement.dataset.theme || 'auto';
            const next = THEME_ORDER[(THEME_ORDER.indexOf(current) + 1) % THEME_ORDER.length];
            try {
                if (next === 'auto') localStorage.removeItem('npc_tema'); else localStorage.setItem('npc_tema', next);
            } catch { /* ignorar */ }
            applyTheme(next);
        });
    }

    /* ------------------------------------------------------------------ */
    /* Técnico (fica salvo no aparelho)                                     */
    /* ------------------------------------------------------------------ */

    function saveProfile() {
        writeJson(KEYS.profile, { nome: fields.technician.value.trim(), codigo: fields.accessCode.value });
    }
    function applyProfile() {
        const profile = readJson(KEYS.profile, {});
        if (profile.nome) fields.technician.value = profile.nome;
        if (profile.codigo) fields.accessCode.value = profile.codigo;
    }

    /* ------------------------------------------------------------------ */
    /* Localização                                                          */
    /* ------------------------------------------------------------------ */

    function updateAddress() {
        fields.address.value = ADDRESSES[fields.client.value] || '';
        renderLocations();
    }

    function renderLocations() {
        const list = knownLocations[fields.client.value] || [];
        fields.locations.replaceChildren(...list.map((name) => {
            const option = document.createElement('option');
            option.value = name;
            return option;
        }));
    }

    /** Busca os locais já usados na planilha, para padronizar nomes ("Sala 04" x "Sala 4"). */
    async function loadLocations() {
        knownLocations = readJson(KEYS.locais, {});
        renderLocations();
        if (!navigator.onLine) return;
        try {
            const response = await fetch(`${API_URL}?acao=locais`, { signal: AbortSignal.timeout?.(15000) });
            const result = await response.json();
            if (result?.status === 'ok' && result.data && typeof result.data === 'object') {
                knownLocations = result.data;
                writeJson(KEYS.locais, knownLocations);
                renderLocations();
            }
        } catch { /* sem a lista o campo continua funcionando como texto livre */ }
    }

    /** Se o técnico digitou "sala 4" e já existe "Sala 04", usa a grafia cadastrada. */
    function matchKnownLocation() {
        const typed = fields.location.value.trim();
        if (!typed) return;
        const key = normalize(typed).replace(/(\D)0+(\d)/g, '$1$2');
        const match = (knownLocations[fields.client.value] || [])
            .find((name) => normalize(name).replace(/(\D)0+(\d)/g, '$1$2') === key);
        if (match && match !== typed) fields.location.value = match;
    }

    /* ------------------------------------------------------------------ */
    /* Checklist PMOC                                                       */
    /* ------------------------------------------------------------------ */

    function buildChecklist() {
        const items = $('#checklist-itens');
        CHECKLIST.forEach(([key, label]) => {
            const row = document.createElement('div');
            row.className = 'input-group checklist-row';
            const title = document.createElement('span');
            title.className = 'checklist-label';
            title.id = `chk-label-${key}`;
            title.textContent = label;
            const options = document.createElement('div');
            options.className = 'checklist-options';
            options.setAttribute('role', 'radiogroup');
            options.setAttribute('aria-labelledby', title.id);
            CHECKLIST_OPTIONS.forEach((value, index) => {
                const tile = document.createElement('label');
                tile.className = `radio-tile radio-tile-sm chk-${index}`;
                const input = document.createElement('input');
                input.type = 'radio';
                input.name = `chk_${key}`;
                input.value = value;
                input.required = true;
                const text = document.createElement('span');
                text.className = 'radio-label';
                text.textContent = value;
                tile.append(input, text);
                options.append(tile);
            });
            row.append(title, options);
            items.append(row);
        });

        const measurements = $('#medicoes-itens');
        MEASUREMENTS.forEach(([key, label, unit]) => {
            const group = document.createElement('div');
            group.className = 'input-group';
            const title = document.createElement('label');
            title.htmlFor = `med_${key}`;
            title.textContent = `${label} (${unit})`;
            const input = document.createElement('input');
            input.type = 'number';
            input.step = '0.1';
            input.inputMode = 'decimal';
            input.id = `med_${key}`;
            input.name = `med_${key}`;
            group.append(title, input);
            measurements.append(group);
        });

        $('#btn-checklist-ok').addEventListener('click', () => {
            CHECKLIST.forEach(([key]) => {
                const group = form.elements.namedItem(`chk_${key}`);
                if (!group.value) group.value = 'OK';
            });
            fields.checklist.querySelectorAll('.invalid').forEach((row) => row.classList.remove('invalid'));
            saveDraft();
        });
    }

    function isPreventive() {
        return form.elements.namedItem('tipo_manutencao').value === 'Preventiva';
    }

    function updateChecklistVisibility() {
        const preventive = isPreventive();
        fields.checklist.hidden = !preventive;
        // Fieldset desabilitado fica fora da validação e do envio.
        fields.checklist.disabled = !preventive;
    }

    /* ------------------------------------------------------------------ */
    /* Mídias                                                               */
    /* ------------------------------------------------------------------ */

    function totalMediaSize() {
        return media.reduce((total, item) => total + item.size, 0);
    }

    function updateMediaCount() {
        const count = media.length;
        fields.mediaCount.textContent = count
            ? `${count} mídia${count > 1 ? 's' : ''} anexada${count > 1 ? 's' : ''} (${humanSize(totalMediaSize())}).`
            : 'Nenhuma mídia anexada.';
    }

    function renderMedia() {
        fields.gallery.replaceChildren();
        media.forEach((item) => {
            const box = document.createElement('div');
            box.className = 'item-midia-preview';
            const element = document.createElement(item.type.startsWith('image/') ? 'img' : 'video');
            element.src = item.dataUrl;
            element.alt = item.type.startsWith('image/') ? `Foto: ${item.name}` : `Vídeo: ${item.name}`;
            if (element instanceof HTMLVideoElement) {
                element.muted = true;
                element.playsInline = true;
                element.controls = true;
            }
            box.append(element);
            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'btn-remover-midia';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Remover ${item.name}`);
            remove.addEventListener('click', () => {
                media = media.filter((mediaItem) => mediaItem.id !== item.id);
                renderMedia();
                validateMedia();
            });
            box.append(remove);
            fields.gallery.append(box);
        });
        updateMediaCount();
    }

    function readAsDataUrl(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onerror = () => reject(new Error(`Não foi possível ler ${file.name}.`));
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(file);
        });
    }

    async function compressImage(file) {
        // Object URL evita carregar o arquivo inteiro em base64 só para decodificar.
        const source = URL.createObjectURL(file);
        const image = new Image();
        try {
            await new Promise((resolve, reject) => {
                image.onload = resolve;
                image.onerror = () => reject(new Error(`${file.name}: não foi possível abrir a imagem.`));
                image.src = source;
            });
        } finally {
            URL.revokeObjectURL(source);
        }
        const ratio = Math.min(1, CONFIG.imageMaxWidth / image.width, CONFIG.imageMaxHeight / image.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * ratio);
        canvas.height = Math.round(image.height * ratio);
        const context = canvas.getContext('2d');
        // JPEG não tem transparência: sem fundo branco, PNGs transparentes ficariam pretos.
        context.fillStyle = '#fff';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise((resolve, reject) => canvas.toBlob((result) => result ? resolve(result) : reject(new Error('Falha ao comprimir imagem.')), 'image/jpeg', CONFIG.imageQuality));
        return { dataUrl: await readAsDataUrl(blob), size: blob.size, type: 'image/jpeg' };
    }

    async function addMedia(files) {
        const messages = [];
        for (const file of files) {
            if (media.length >= CONFIG.maxFiles) { messages.push(`Limite de ${CONFIG.maxFiles} arquivos atingido.`); break; }
            const isImage = file.type.startsWith('image/');
            const isVideo = file.type.startsWith('video/');
            if (!isImage && !isVideo) { messages.push(`${file.name}: formato não aceito.`); continue; }
            if (file.size > (isImage ? CONFIG.maxImageSize : CONFIG.maxVideoSize)) { messages.push(`${file.name}: excede o tamanho permitido.`); continue; }
            try {
                const processed = isImage ? await compressImage(file) : { dataUrl: await readAsDataUrl(file), size: file.size, type: file.type };
                if (totalMediaSize() + processed.size > CONFIG.maxTotalSize) { messages.push(`${file.name}: excede o limite total de ${humanSize(CONFIG.maxTotalSize)}.`); continue; }
                media.push({ id: uuid(), name: file.name, ...processed });
            } catch (error) { messages.push(error.message); }
        }
        renderMedia();
        validateMedia();
        if (messages.length) showError(messages.join(' '), 'Atenção com as mídias');
    }

    function validateMedia() {
        const valid = media.length > 0;
        fields.media.closest('.input-group').classList.toggle('invalid', !valid);
        return valid;
    }

    /* ------------------------------------------------------------------ */
    /* Ditado por voz                                                       */
    /* ------------------------------------------------------------------ */

    function initVoiceInput() {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
            document.querySelectorAll('.btn-voice').forEach((button) => { button.hidden = true; });
            return;
        }
        const recognition = new Recognition();
        recognition.lang = 'pt-BR';
        recognition.interimResults = false;
        let activeButton = null;
        let pendingButton = null; // botão clicado enquanto outro ditado ainda encerrava
        const start = (button) => {
            activeButton = button;
            try { recognition.start(); } catch { activeButton = null; }
        };
        document.querySelectorAll('.btn-voice').forEach((button) => button.addEventListener('click', () => {
            if (!activeButton) { start(button); return; }
            // Clicar no mesmo botão para o ditado; clicar em outro troca de campo.
            pendingButton = activeButton === button ? null : button;
            recognition.stop();
        }));
        recognition.onstart = () => { activeButton?.classList.add('listening'); activeButton?.setAttribute('aria-label', 'Parar ditado'); };
        recognition.onresult = (event) => {
            const target = activeButton && document.getElementById(activeButton.dataset.target);
            if (!target) return;
            const text = event.results[0][0].transcript.trim();
            if (!text) return;
            target.value = `${target.value}${target.value ? ' ' : ''}${text}`.slice(0, target.maxLength > 0 ? target.maxLength : undefined);
            target.dispatchEvent(new Event('input', { bubbles: true }));
            target.closest('.input-group')?.classList.remove('invalid');
        };
        recognition.onerror = (event) => {
            // "no-speech" e "aborted" são normais (silêncio ou parada manual); não incomodar o técnico.
            if (event.error === 'not-allowed' || event.error === 'service-not-allowed') {
                showError('Permita o uso do microfone no navegador para digitar por voz.', 'Microfone bloqueado');
            } else if (event.error === 'network') {
                showError('O ditado por voz precisa de internet. Verifique a conexão.', 'Ditado indisponível');
            }
        };
        recognition.onend = () => {
            activeButton?.classList.remove('listening');
            activeButton?.setAttribute('aria-label', 'Digitar por voz');
            activeButton = null;
            if (pendingButton) { const next = pendingButton; pendingButton = null; start(next); }
        };
    }

    /* ------------------------------------------------------------------ */
    /* Assinatura                                                           */
    /* ------------------------------------------------------------------ */

    function clearCanvas() {
        const context = fields.canvas.getContext('2d');
        context.save();
        context.setTransform(1, 0, 0, 1, 0, 0);
        context.clearRect(0, 0, fields.canvas.width, fields.canvas.height);
        context.restore();
        strokes = 0;
        fields.signature.value = '';
    }

    function initSignature() {
        const { canvas, signature, signatureError } = fields;
        const context = canvas.getContext('2d');
        let previous = null;
        let canvasWidth = 0;
        let canvasRatio = 0;
        const applyStyle = () => { context.strokeStyle = '#000'; context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round'; context.fillStyle = '#000'; };
        const setupCanvas = () => {
            const rect = canvas.getBoundingClientRect();
            const ratio = window.devicePixelRatio || 1;
            // No celular o "resize" dispara ao rolar a página (barra de endereço some/aparece).
            // Só recriamos o canvas quando a largura muda de fato.
            if (!rect.width || (Math.round(rect.width) === canvasWidth && ratio === canvasRatio)) return;
            const saved = strokes ? canvas.toDataURL() : null;
            const oldWidth = canvasWidth;
            const oldHeight = canvas.height / (canvasRatio || 1);
            canvasWidth = Math.round(rect.width); canvasRatio = ratio;
            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            applyStyle();
            if (saved) {
                const image = new Image();
                image.onload = () => { context.drawImage(image, 0, 0, oldWidth, oldHeight); signature.value = canvas.toDataURL('image/png'); };
                image.src = saved;
            }
        };
        const position = (event) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
        const endStroke = () => {
            if (!drawing) return;
            drawing = false;
            // Gerar o PNG só ao final de cada traço (gerar a cada movimento travava celulares).
            signature.value = canvas.toDataURL('image/png');
            if (isSignatureValid()) {
                signatureError.style.display = 'none';
                canvas.closest('.signature-container').classList.remove('signature-invalid');
            }
        };
        canvas.addEventListener('pointerdown', (event) => {
            if (event.button !== 0 && event.pointerType === 'mouse') return;
            setupCanvas();
            drawing = true;
            previous = position(event);
            canvas.setPointerCapture?.(event.pointerId);
            // Um toque simples também deixa um ponto (útil em rubricas e pingos de "i").
            context.beginPath(); context.arc(previous.x, previous.y, context.lineWidth / 2, 0, Math.PI * 2); context.fill();
        });
        canvas.addEventListener('pointermove', (event) => {
            if (!drawing) return;
            const point = position(event);
            context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(point.x, point.y); context.stroke();
            previous = point;
            strokes += 1; // segmentos desenhados: evita aceitar um simples toque como assinatura
        });
        canvas.addEventListener('pointerup', endStroke);
        canvas.addEventListener('pointercancel', endStroke);
        fields.clearSignature.addEventListener('click', clearCanvas);
        window.addEventListener('resize', setupCanvas);
        setupCanvas();
    }

    function isSignatureValid() {
        return strokes >= CONFIG.minSignatureStrokes && Boolean(fields.signature.value);
    }

    function validateSignature() {
        const valid = isSignatureValid();
        fields.signatureError.style.display = valid ? 'none' : 'block';
        fields.canvas.closest('.signature-container').classList.toggle('signature-invalid', !valid);
        return valid;
    }

    /* ------------------------------------------------------------------ */
    /* Validação                                                            */
    /* ------------------------------------------------------------------ */

    /** Regras que o HTML sozinho não cobre. */
    function applyCustomRules() {
        fields.date.max = localDate();
        const { start, end, serial, model } = fields;
        end.setCustomValidity(start.value && end.value && end.value <= start.value ? 'O término deve ser depois do início.' : '');
        // Na planilha, a série costumava repetir o modelo ou a capacidade ("9 mil").
        const repeated = serial.value && (normalize(serial.value) === normalize(model.value) || /\b(mil|btus?)\b/i.test(serial.value));
        serial.setCustomValidity(repeated ? 'Série repetindo o modelo ou a capacidade.' : '');
    }

    function validateForm() {
        applyCustomRules();
        let valid = form.checkValidity();
        form.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((field) => {
            const group = field.closest('.input-group');
            if (group && field.willValidate && !field.validity.valid) group.classList.add('invalid');
        });
        // Valida tudo (sem curto-circuito) para marcar todos os erros de uma vez.
        const mediaValid = validateMedia();
        const signatureValid = validateSignature();
        valid = mediaValid && signatureValid && valid;
        if (!valid) focusFirstError();
        return valid;
    }

    function focusFirstError() {
        const group = form.querySelector('.input-group.invalid, .input-group:has(.signature-invalid)');
        if (!group) return;
        group.scrollIntoView({ behavior: 'smooth', block: 'center' });
        const isVisible = (element) => element.offsetParent !== null || element.matches('.radio-tile input');
        // O input de arquivo fica oculto; nesse caso focamos o botão visível de anexar.
        const focusable = [...group.querySelectorAll('input:not([type="hidden"]), textarea, select')].find(isVisible)
            || [...group.querySelectorAll('label[tabindex], button')].find(isVisible);
        focusable?.focus({ preventScroll: true });
    }

    /* ------------------------------------------------------------------ */
    /* Rascunho                                                             */
    /* ------------------------------------------------------------------ */

    function saveDraft() {
        const draft = Object.fromEntries(new FormData(form).entries());
        // Não persistir assinatura, código de acesso ou mídias como rascunho.
        delete draft.assinatura_base64;
        delete draft.codigo_acesso;
        delete draft.website;
        writeJson(KEYS.draft, draft);
    }

    function restoreDraft() {
        const draft = readJson(KEYS.draft, {});
        if (draft && typeof draft === 'object') {
            Object.entries(draft).forEach(([name, value]) => setField(name, value));
        }
    }

    /** Link do QR Code da etiqueta do aparelho: ?cliente=LIFE&local=Sala%2004&marca=LG... */
    function applyUrlPrefill() {
        const params = new URLSearchParams(location.search);
        let applied = 0;
        Object.entries(URL_PREFILL).forEach(([param, name]) => {
            if (params.has(param) && setField(name, params.get(param).trim())) applied += 1;
        });
        if (applied) showNotice('Dados do equipamento preenchidos pela etiqueta (QR Code).');
    }

    function setDefaults() {
        if (!fields.date.value) fields.date.value = localDate();
        if (!fields.start.value) fields.start.value = localTime();
    }

    /* ------------------------------------------------------------------ */
    /* Envio                                                                */
    /* ------------------------------------------------------------------ */

    function formPayload() {
        const data = Object.fromEntries(new FormData(form).entries());
        const preventive = isPreventive();
        const checklist = preventive ? CHECKLIST.map(([key, label]) => ({ item: label, resultado: data[`chk_${key}`] || '' })) : [];
        const medicoes = preventive
            ? MEASUREMENTS.filter(([key]) => data[`med_${key}`] !== undefined && data[`med_${key}`] !== '')
                .map(([key, label, unit]) => ({ item: label, valor: data[`med_${key}`], unidade: unit }))
            : [];
        Object.keys(data).forEach((key) => { if (/^(chk|med)_/.test(key)) delete data[key]; });
        // A assinatura vai só em "assinatura_responsavel" (antes ia duplicada, dobrando o envio).
        delete data.assinatura_base64;
        return {
            ...data,
            id_envio: uuid(),
            versao_formulario: FORM_VERSION,
            endereco: ADDRESSES[data.cliente] || data.endereco || '',
            // O formulário usa este identificador; o Apps Script grava-o como localização interna.
            localizacao_interna: data.localizacao_aparelho,
            pecas_substituidas: data.pecas_substituidas || 'Nenhuma',
            assinatura_responsavel: fields.signature.value,
            checklist,
            medicoes,
            arquivos: media.map(({ name, type, size, dataUrl }) => ({ name, type, size, base64: dataUrl }))
        };
    }

    /**
     * Envia um relatório. Resultado:
     *  ok       gravado (data traz numero_os)
     *  retry    falha temporária (sem internet, servidor ocupado): tentar de novo depois
     *  rejected a planilha recusou (dado inválido, código de acesso errado)
     */
    async function sendPayload(payload) {
        if (!navigator.onLine) return { kind: 'retry', message: 'Sem conexão com a internet.' };
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeout);
        let response;
        try {
            response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), signal: controller.signal });
        } catch (error) {
            return { kind: 'retry', message: error.name === 'AbortError' ? 'A planilha demorou demais para responder.' : 'Falha de conexão com a planilha.' };
        } finally {
            clearTimeout(timeout);
        }
        if (response.status === 404) {
            return { kind: 'rejected', message: 'A implantação do Google Apps Script não foi encontrada. Publique uma nova versão e confira a URL /exec no script.js.' };
        }
        if (response.status >= 500 || response.status === 429) return { kind: 'retry', message: `A planilha está indisponível (erro ${response.status}).` };
        if (!response.ok) return { kind: 'rejected', message: `O servidor respondeu com erro ${response.status}.` };

        // Apps Script costuma responder JSON como text/plain; lemos o corpo e aceitamos os formatos usuais.
        const responseText = (await response.text()).trim();
        let result;
        try { result = JSON.parse(responseText); } catch { result = { status: responseText.toLowerCase() }; }
        const okWords = ['success', 'sucesso', 'ok'];
        const confirmed = result.success === true || [result.status, result.result].some((value) => okWords.includes(String(value || '').toLowerCase()));
        if (confirmed) return { kind: 'ok', data: result.data || {} };
        if (result.retry) return { kind: 'retry', message: result.message || 'Servidor ocupado.' };
        return { kind: 'rejected', message: result.message || 'O servidor não confirmou o registro.', code: result.codigo };
    }

    function successMessage(data) {
        const parts = [data.numero_os ? `OS ${data.numero_os} registrada na planilha.` : 'Dados enviados corretamente.'];
        if (data.email_enviado) parts.push('O PDF foi enviado por e-mail.');
        if (data.duplicado) parts.push('(Este relatório já tinha sido recebido antes.)');
        return parts.join(' ');
    }

    function setBusy(busy) {
        fields.submit.disabled = busy;
        fields.submit.querySelector('.btn-text').textContent = busy ? 'Enviando…' : 'Revisar e Enviar';
        fields.submit.querySelector('.btn-spinner').classList.toggle('hidden', !busy);
    }

    function resetForm() {
        form.reset();
        media = [];
        clearCanvas();
        form.querySelectorAll('.invalid').forEach((group) => group.classList.remove('invalid'));
        removeKey(KEYS.draft);
        applyProfile();
        updateAddress();
        updateChecklistVisibility();
        renderMedia();
        setDefaults();
    }

    async function submitCurrent() {
        if (sending) return;
        sending = true;
        setBusy(true);
        const payload = formPayload();
        // Guardar ANTES de enviar: se a internet cair ou a página fechar no meio, nada se perde.
        let queued = false;
        try {
            await queue.put({ id_envio: payload.id_envio, payload, criado_em: new Date().toISOString(), erro: null });
            queued = true;
        } catch { /* sem IndexedDB (navegador antigo/modo restrito): envia direto */ }

        try {
            const result = await sendPayload(payload);
            if (result.kind === 'ok') {
                if (queued) await queue.remove(payload.id_envio).catch(() => {});
                resetForm();
                showSuccess('✓ Relatório enviado', successMessage(result.data));
            } else if (result.kind === 'retry' && queued) {
                resetForm();
                showSuccess('Salvo no aparelho', `${result.message} O relatório ficou guardado neste aparelho e será enviado automaticamente quando a conexão voltar. Não limpe os dados do navegador até lá.`, 'var(--warning-dark)');
            } else {
                // Recusado: o formulário continua preenchido para corrigir e reenviar.
                if (queued) await queue.remove(payload.id_envio).catch(() => {});
                if (result.code === 'acesso') {
                    fields.accessCode.closest('.input-group').classList.add('invalid');
                    fields.accessCode.focus();
                }
                showError(result.kind === 'retry' ? `${result.message} Tente novamente.` : result.message);
            }
        } finally {
            sending = false;
            setBusy(false);
            refreshQueueBanner();
        }
    }

    /* ------------------------------------------------------------------ */
    /* Fila offline (IndexedDB)                                             */
    /* ------------------------------------------------------------------ */

    const queue = (() => {
        let dbPromise = null;
        const open = () => {
            if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB indisponível'));
            dbPromise ||= new Promise((resolve, reject) => {
                const request = indexedDB.open('npc-manutencao', 1);
                request.onupgradeneeded = () => request.result.createObjectStore('fila', { keyPath: 'id_envio' });
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => { dbPromise = null; reject(request.error); };
            });
            return dbPromise;
        };
        const run = async (mode, action) => {
            const db = await open();
            return new Promise((resolve, reject) => {
                const transaction = db.transaction('fila', mode);
                const request = action(transaction.objectStore('fila'));
                transaction.oncomplete = () => resolve(request.result);
                transaction.onerror = () => reject(transaction.error);
                transaction.onabort = () => reject(transaction.error);
            });
        };
        return {
            put: (item) => run('readwrite', (store) => store.put(item)),
            remove: (id) => run('readwrite', (store) => store.delete(id)),
            all: () => run('readonly', (store) => store.getAll())
        };
    })();

    async function refreshQueueBanner() {
        let items = [];
        try { items = await queue.all(); } catch { /* sem fila */ }
        if (!items.length) { fields.queueBanner.classList.add('hidden'); return; }
        const failed = items.filter((item) => item.erro);
        let text = `${plural(items.length, 'relatório guardado', 'relatórios guardados')} neste aparelho aguardando envio.`;
        if (failed.length) text += ` ${plural(failed.length, 'foi recusado', 'foram recusados')} pela planilha: ${failed[0].erro}`;
        fields.queueText.textContent = text;
        $('#btn-fila-descartar').classList.toggle('hidden', !failed.length);
        fields.queueBanner.classList.remove('hidden');
    }

    /** Envia o que ficou guardado. `force` reenvia também os que a planilha recusou antes. */
    async function flushQueue(force = false) {
        if (flushing || sending || !navigator.onLine) return;
        flushing = true;
        const sent = [];
        try {
            const items = (await queue.all()).sort((a, b) => a.criado_em.localeCompare(b.criado_em));
            for (const item of items) {
                if (item.erro && !force) continue;
                // Usa o código de acesso atual: o técnico pode tê-lo corrigido depois.
                if (fields.accessCode.value) item.payload.codigo_acesso = fields.accessCode.value;
                if (fields.technician.value && !item.payload.tecnico_nome) item.payload.tecnico_nome = fields.technician.value;
                const result = await sendPayload(item.payload);
                if (result.kind === 'ok') {
                    await queue.remove(item.id_envio);
                    sent.push(result.data.numero_os || '');
                } else if (result.kind === 'retry') {
                    break; // continua sem conexão; tenta no próximo ciclo
                } else {
                    item.erro = result.message;
                    await queue.put(item);
                }
            }
        } catch { /* fila indisponível */ } finally {
            flushing = false;
            await refreshQueueBanner();
        }
        if (sent.length) {
            const numbers = sent.filter(Boolean);
            showNotice(`${plural(sent.length, 'relatório guardado foi enviado', 'relatórios guardados foram enviados')}${numbers.length ? ` (${numbers.join(', ')})` : ''}.`);
        }
    }

    async function discardFailed() {
        const items = (await queue.all().catch(() => [])).filter((item) => item.erro);
        if (!items.length) return;
        const ok = window.confirm(`Descartar ${plural(items.length, 'relatório recusado', 'relatórios recusados')}? Os dados, fotos e assinaturas serão apagados deste aparelho e não podem ser recuperados.`);
        if (!ok) return;
        await Promise.all(items.map((item) => queue.remove(item.id_envio).catch(() => {})));
        refreshQueueBanner();
    }

    /* ------------------------------------------------------------------ */
    /* Revisão antes do envio                                               */
    /* ------------------------------------------------------------------ */

    function buildReview() {
        const data = Object.fromEntries(new FormData(form).entries());
        const list = $('#resumo-envio');
        const rows = [
            ['Técnico', data.tecnico_nome],
            ['Local', `${data.cliente} · ${data.localizacao_aparelho}`],
            ['Equipamento', [data.tipo_equipamento, data.marca, data.capacidade_btus && `${data.capacidade_btus} BTUs`].filter(Boolean).join(' · ')],
            ['Modelo / série', [data.modelo, data.numero_serie || 'sem série'].join(' / ')],
            ['Data e horário', `${data.data_manutencao.split('-').reverse().join('/')}, ${data.hora_inicio} às ${data.hora_fim}`],
            ['Manutenção', data.tipo_manutencao],
            ['Status', data.status_servico === 'Concluido' ? 'Concluído' : 'Pendente'],
            ['Mídias', plural(media.length, 'arquivo', 'arquivos')],
            ['Responsável', [data.responsavel_nome, data.responsavel_cargo].filter(Boolean).join(' · ')]
        ];
        if (isPreventive()) {
            const failures = CHECKLIST.filter(([key]) => data[`chk_${key}`] === 'Não conforme');
            rows.splice(6, 0, ['Checklist', failures.length ? plural(failures.length, 'item não conforme', 'itens não conformes') : 'Todos os itens OK ou N/A']);
        }
        if (data.email_os) rows.push(['PDF por e-mail', data.email_os]);
        list.replaceChildren(...rows.flatMap(([label, value]) => {
            const term = document.createElement('dt');
            term.textContent = label;
            const description = document.createElement('dd');
            description.textContent = value || '—';
            return [term, description];
        }));
    }

    /* ------------------------------------------------------------------ */
    /* Eventos                                                              */
    /* ------------------------------------------------------------------ */

    fields.client.addEventListener('change', updateAddress);
    fields.location.addEventListener('change', matchKnownLocation);
    fields.technician.addEventListener('input', saveProfile);
    fields.accessCode.addEventListener('input', saveProfile);
    // O botão de anexar é um <label>; permitir abri-lo pelo teclado (Enter/Espaço).
    $('label[for="arquivos_midia"]').addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fields.media.click(); }
    });
    fields.media.addEventListener('change', async (event) => { await addMedia([...event.target.files]); event.target.value = ''; });
    form.addEventListener('input', (event) => {
        if (event.target.closest('.input-group.invalid') && event.target.validity?.valid) {
            event.target.closest('.input-group').classList.remove('invalid');
        }
        saveDraft();
    });
    form.addEventListener('change', (event) => {
        if (event.target.name === 'tipo_manutencao') updateChecklistVisibility();
        applyCustomRules();
        const group = event.target.closest('.input-group');
        if (group && event.target.validity?.valid) group.classList.remove('invalid');
        saveDraft();
    });
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        if (sending || !validateForm()) return;
        buildReview();
        setModal('modal-confirmacao', true);
    });
    $('#btn-confirmar-modal').addEventListener('click', () => { closeModals(); submitCurrent(); });
    $('#btn-cancelar-modal').addEventListener('click', closeModals);
    $('#btn-fechar-sucesso').addEventListener('click', closeModals);
    $('#btn-fechar-erro').addEventListener('click', closeModals);
    $('#btn-fila-enviar').addEventListener('click', () => flushQueue(true));
    $('#btn-fila-descartar').addEventListener('click', discardFailed);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModals(); });
    window.addEventListener('online', () => { flushQueue(); loadLocations(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') flushQueue(); });
    setInterval(() => flushQueue(), CONFIG.queueRetryInterval);

    /* ------------------------------------------------------------------ */
    /* Início                                                               */
    /* ------------------------------------------------------------------ */

    initTheme();
    buildChecklist();
    restoreDraft();
    applyProfile();
    applyUrlPrefill();
    updateAddress();
    updateChecklistVisibility();
    setDefaults();
    applyCustomRules();
    initVoiceInput();
    initSignature();
    renderMedia();
    refreshQueueBanner().then(() => flushQueue());
    loadLocations();

    // App instalável e com abertura offline (service worker só funciona em https ou localhost).
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
        navigator.serviceWorker.register('sw.js').catch(() => {});
    }
});
