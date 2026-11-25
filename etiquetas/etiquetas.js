// Gerador de etiquetas QR Code dos aparelhos de ar condicionado.
// Cada QR abre o formulário (pasta acima desta) já preenchido com os dados do equipamento.
(() => {
    'use strict';
    const form = document.getElementById('form-etiqueta');
    const list = document.getElementById('etiquetas');
    const count = document.getElementById('contagem');
    const STORAGE_KEY = 'npc_etiquetas_v1';
    // Mesmos nomes de parâmetro que o formulário lê (URL_PREFILL no script.js da raiz).
    const FIELDS = ['cliente', 'local', 'tipo', 'marca', 'modelo', 'serie', 'btus', 'gas'];
    const FORM_URL = new URL('../', location.href);
    let labels = [];
    try { labels = JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { labels = []; }

    const save = () => {
        try { localStorage.setItem(STORAGE_KEY, JSON.stringify(labels)); } catch { /* ignorar */ }
    };

    function linkFor(label) {
        const url = new URL(FORM_URL);
        FIELDS.forEach((key) => { if (label[key]) url.searchParams.set(key, label[key]); });
        return url.toString();
    }

    function render() {
        list.replaceChildren();
        labels.forEach((label, index) => {
            const card = document.createElement('div');
            card.className = 'label-card';

            const brand = document.createElement('span');
            brand.className = 'brand';
            brand.textContent = 'NPC · MANUTENÇÃO AR CONDICIONADO';

            const qr = document.createElement('div');
            qr.className = 'qr';

            const title = document.createElement('strong');
            title.textContent = `${label.cliente} · ${label.local}`;

            const details = document.createElement('small');
            details.textContent = [label.tipo, label.marca, label.btus && `${label.btus} BTUs`, label.modelo, label.serie && `S/N ${label.serie}`]
                .filter(Boolean).join(' · ');

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'label-remove';
            remove.textContent = '×';
            remove.setAttribute('aria-label', `Remover etiqueta ${title.textContent}`);
            remove.addEventListener('click', () => { labels.splice(index, 1); save(); render(); });

            card.append(remove, brand, qr, title, details);
            list.append(card);

            if (window.QRCode) {
                new window.QRCode(qr, { text: linkFor(label), width: 300, height: 300, correctLevel: window.QRCode.CorrectLevel.M });
            } else {
                qr.textContent = 'Sem internet para gerar o QR Code.';
            }
        });
        count.textContent = labels.length
            ? `${labels.length} etiqueta${labels.length > 1 ? 's' : ''} na folha.`
            : 'Nenhuma etiqueta na folha.';
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        let valid = true;
        form.querySelectorAll('[required]').forEach((field) => {
            const ok = field.value.trim() !== '';
            field.closest('.field').classList.toggle('invalid', !ok);
            valid = valid && ok;
        });
        if (!valid) return;
        const label = {};
        FIELDS.forEach((key) => { label[key] = document.getElementById(key).value.trim(); });
        labels.push(label);
        save();
        render();
        // Mantém cliente, tipo e capacidade para cadastrar vários aparelhos seguidos.
        ['local', 'marca', 'modelo', 'serie'].forEach((key) => { document.getElementById(key).value = ''; });
        document.getElementById('local').focus();
    });

    form.addEventListener('input', (event) => {
        if (event.target.value.trim()) event.target.closest('.field')?.classList.remove('invalid');
    });
    document.getElementById('btn-imprimir').addEventListener('click', () => window.print());
    render();
})();
