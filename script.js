document.addEventListener('DOMContentLoaded', () => {
    'use strict';

    // O Apps Script deve responder JSON, por exemplo: { "success": true }.
    // Proteja o endpoint no servidor; a URL pública não é um mecanismo de autenticação.
    // Substitua pela URL /exec da implantação ativa do seu Google Apps Script.
    // O erro 404 indica que a implantação desta URL não está mais disponível.
    const API_URL = 'https://script.google.com/macros/s/AKfycbyBqniVF28HJq5_KdaF7n8bIf1r4uXSPY90vAFJu1w7f3R8No0LlUXUl6RHQJ8shUx2Jw/exec';
    const STORAGE_KEY = 'formulario_manutencao_v2';
    const CONFIG = {
        maxFiles: 3,
        // Fotos grandes são aceitas e compactadas antes do envio.
        maxImageSize: 8 * 1024 * 1024,
        // Vídeos não são compactados no navegador; mantê-los pequenos reduz muito o tempo.
        maxVideoSize: 2 * 1024 * 1024,
        maxTotalSize: 5 * 1024 * 1024,
        imageQuality: 0.65,
        imageMaxWidth: 1280,
        imageMaxHeight: 1280,
        minSignatureStrokes: 5,
        requestTimeout: 120000
    };
    const addresses = {
        MATRIZ: 'Rua Desembargador Leite Albuquerque, 1320 - Aldeota',
        LIFE: 'Rua Coronel Linhares, 1143 - Aldeota',
        SUL: 'Rua Virgilio Paes, 3020 - Cidades dos Funcionários'
    };

    const form = document.getElementById('form-manutencao');
    const $ = (selector) => document.querySelector(selector);
    const fields = {
        client: $('#cliente'), address: $('#endereco'), date: $('#data_manutencao'),
        media: $('#arquivos_midia'), gallery: $('#galeria-preview'), mediaCount: $('#media-count'),
        canvas: $('#canvas-assinatura'), signature: $('#assinatura_base64'), signatureError: $('#erro-assinatura'),
        clearSignature: $('#btn-limpar-assinatura'), submit: $('#btn-finalizar')
    };
    let media = [];
    let sending = false;
    let strokes = 0;
    let drawing = false;
    let lastFocus = null;

    function localDate() {
        const now = new Date();
        const offset = now.getTimezoneOffset() * 60000;
        return new Date(now - offset).toISOString().slice(0, 10);
    }

    function updateAddress() {
        fields.address.value = addresses[fields.client.value] || '';
    }

    function setTodayIfEmpty() {
        if (!fields.date.value) fields.date.value = localDate();
    }

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
        ['modal-confirmacao', 'modal-sucesso', 'modal-erro'].forEach((id) => setModal(id, false));
    }

    function showError(message) {
        $('#modal-erro-mensagem').textContent = message;
        setModal('modal-erro', true);
    }

    function humanSize(bytes) {
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
    }

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
            if (element instanceof HTMLVideoElement) element.muted = true;
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
        const source = await readAsDataUrl(file);
        const image = new Image();
        await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; image.src = source; });
        const ratio = Math.min(1, CONFIG.imageMaxWidth / image.width, CONFIG.imageMaxHeight / image.height);
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.width * ratio);
        canvas.height = Math.round(image.height * ratio);
        canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
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
                media.push({ id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`, name: file.name, ...processed });
            } catch (error) { messages.push(error.message); }
        }
        renderMedia();
        validateMedia();
        if (messages.length) showError(messages.join(' '));
    }

    function mediaGroup() { return fields.media.closest('.input-group'); }
    function validateMedia() {
        const valid = media.length > 0;
        mediaGroup().classList.toggle('invalid', !valid);
        return valid;
    }

    function initVoiceInput() {
        const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Recognition) {
            document.querySelectorAll('.btn-voice').forEach((button) => {
                button.hidden = true;
            });
            return;
        }
        const recognition = new Recognition();
        recognition.lang = 'pt-BR';
        recognition.interimResults = false;
        let activeButton = null;
        let target = null;
        document.querySelectorAll('.btn-voice').forEach((button) => button.addEventListener('click', () => {
            if (activeButton) recognition.stop();
            target = document.getElementById(button.dataset.target);
            activeButton = button;
            try { recognition.start(); } catch { /* reconhecimento já está sendo encerrado */ }
        }));
        recognition.onstart = () => { activeButton?.classList.add('listening'); activeButton?.setAttribute('aria-label', 'Parar ditado'); };
        recognition.onresult = (event) => {
            if (target) target.value += `${target.value ? ' ' : ''}${event.results[0][0].transcript}`;
            target?.dispatchEvent(new Event('input', { bubbles: true }));
        };
        recognition.onerror = () => { if (activeButton) showError('Não foi possível usar o reconhecimento de voz.'); };
        recognition.onend = () => { activeButton?.classList.remove('listening'); activeButton?.removeAttribute('aria-label'); activeButton = null; };
    }

    function initSignature() {
        const { canvas, signature, signatureError } = fields;
        const context = canvas.getContext('2d');
        let previous = null;
        const setupCanvas = () => {
            const saved = canvas.width ? canvas.toDataURL() : null;
            const rect = canvas.getBoundingClientRect();
            const ratio = window.devicePixelRatio || 1;
            canvas.width = Math.round(rect.width * ratio);
            canvas.height = Math.round(rect.height * ratio);
            context.setTransform(ratio, 0, 0, ratio, 0, 0);
            context.strokeStyle = '#000'; context.lineWidth = 3; context.lineCap = 'round'; context.lineJoin = 'round';
            if (saved && strokes) { const image = new Image(); image.onload = () => context.drawImage(image, 0, 0, rect.width, rect.height); image.src = saved; }
        };
        const position = (event) => { const rect = canvas.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
        canvas.addEventListener('pointerdown', (event) => { drawing = true; previous = position(event); canvas.setPointerCapture(event.pointerId); });
        canvas.addEventListener('pointermove', (event) => {
            if (!drawing) return;
            const point = position(event);
            context.beginPath(); context.moveTo(previous.x, previous.y); context.lineTo(point.x, point.y); context.stroke();
            previous = point; strokes += 1; signature.value = canvas.toDataURL('image/png'); signatureError.style.display = 'none';
        });
        canvas.addEventListener('pointerup', () => { drawing = false; });
        fields.clearSignature.addEventListener('click', () => { context.clearRect(0, 0, canvas.width, canvas.height); strokes = 0; signature.value = ''; });
        window.addEventListener('resize', setupCanvas);
        setupCanvas();
    }

    function validateSignature() {
        const valid = strokes >= CONFIG.minSignatureStrokes && Boolean(fields.signature.value);
        fields.signatureError.style.display = valid ? 'none' : 'block';
        fields.canvas.closest('.signature-container').classList.toggle('signature-invalid', !valid);
        return valid;
    }

    function validateForm() {
        let valid = form.checkValidity();
        form.querySelectorAll('input:not([type="hidden"]), textarea, select').forEach((field) => {
            const group = field.closest('.input-group');
            if (group && !field.validity.valid) group.classList.add('invalid');
        });
        valid = validateMedia() && validateSignature() && valid;
        if (!valid) form.querySelector('.invalid input, .invalid textarea, .invalid select, .signature-invalid canvas')?.focus();
        return valid;
    }

    function saveDraft() {
        const draft = Object.fromEntries(new FormData(form).entries());
        delete draft.assinatura_base64; // Não persistir assinatura ou mídias no navegador.
        localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    }

    function restoreDraft() {
        try {
            const draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
            Object.entries(draft).forEach(([name, value]) => {
                const field = form.elements.namedItem(name);
                if (field instanceof RadioNodeList) field.value = value;
                else if (field) field.value = value;
            });
            updateAddress(); setTodayIfEmpty();
        } catch { localStorage.removeItem(STORAGE_KEY); setTodayIfEmpty(); }
    }

    function formPayload() {
        const data = Object.fromEntries(new FormData(form).entries());
        return {
            ...data,
            // O formulário usa este identificador; o Apps Script grava-o como localização interna.
            localizacao_interna: data.localizacao_aparelho,
            pecas_substituidas: data.pecas_substituidas || 'Nenhuma',
            assinatura_responsavel: fields.signature.value,
            arquivos: media.map(({ name, type, size, dataUrl }) => ({ name, type, size, base64: dataUrl }))
        };
    }

    async function sendForm() {
        sending = true;
        fields.submit.disabled = true;
        fields.submit.querySelector('.btn-text').textContent = 'Enviando…';
        fields.submit.querySelector('.btn-spinner').classList.remove('hidden');
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), CONFIG.requestTimeout);
        try {
            const response = await fetch(API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(formPayload()), signal: controller.signal });
            if (response.status === 404) {
                throw new Error('A implantação do Google Apps Script não foi encontrada. Publique uma nova implantação Web App e atualize a URL /exec no arquivo script.js.');
            }
            if (!response.ok) throw new Error(`O servidor respondeu com erro ${response.status}.`);
            // Apps Script costuma responder JSON como text/plain; por isso lemos o
            // corpo antes e aceitamos os formatos de sucesso mais usuais.
            const responseText = (await response.text()).trim();
            let result;
            try {
                result = JSON.parse(responseText);
            } catch {
                result = { status: responseText.toLowerCase() };
            }
            const confirmed = result.success === true
                || ['success', 'sucesso', 'ok'].includes(String(result.status || '').toLowerCase())
                || ['success', 'sucesso', 'ok'].includes(String(result.result || '').toLowerCase())
                || ['success', 'sucesso', 'ok'].includes(String(result.message || '').toLowerCase());
            if (!confirmed) throw new Error(result.message || 'O servidor não confirmou o registro.');
            form.reset(); media = []; strokes = 0; fields.signature.value = ''; fields.canvas.getContext('2d').clearRect(0, 0, fields.canvas.width, fields.canvas.height); renderMedia(); setTodayIfEmpty(); localStorage.removeItem(STORAGE_KEY); setModal('modal-sucesso', true);
        } catch (error) {
            const message = error.name === 'AbortError'
                ? 'A solicitação demorou demais. Verifique a conexão e tente novamente.'
                : `${error.message}${error.message.includes('não foi encontrada') ? '' : ' Confirme se o Apps Script permite CORS e responde JSON.'}`;
            showError(message);
        } finally {
            clearTimeout(timeout); sending = false; fields.submit.disabled = false;
            fields.submit.querySelector('.btn-text').textContent = 'Finalizar e Alimentar Planilha';
            fields.submit.querySelector('.btn-spinner').classList.add('hidden');
        }
    }

    fields.client.addEventListener('change', () => { updateAddress(); saveDraft(); });
    fields.media.addEventListener('change', async (event) => { await addMedia([...event.target.files]); event.target.value = ''; });
    form.addEventListener('input', saveDraft);
    form.addEventListener('change', (event) => { event.target.closest('.input-group')?.classList.remove('invalid'); saveDraft(); });
    form.addEventListener('submit', (event) => { event.preventDefault(); if (!sending && validateForm()) setModal('modal-confirmacao', true); });
    $('#btn-confirmar-modal').addEventListener('click', () => { closeModals(); sendForm(); });
    $('#btn-cancelar-modal').addEventListener('click', closeModals);
    $('#btn-fechar-sucesso').addEventListener('click', closeModals);
    $('#btn-fechar-erro').addEventListener('click', closeModals);
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModals(); });

    restoreDraft();
    initVoiceInput();
    initSignature();
    renderMedia();
});
