/**
 * Backend do formulário NPC - MANUTENÇÃO (Google Apps Script, runtime V8).
 *
 * Como publicar: cole este arquivo no projeto Apps Script vinculado à planilha
 * "NPC - CONTROLE DE OS - AR CONDICIONADOS" e publique uma NOVA versão em
 * Implantar > Gerenciar implantações > Editar > Nova versão (a URL /exec continua a mesma).
 *
 * Propriedades do script (Configurações do projeto > Propriedades do script), todas opcionais:
 *   CODIGO_ACESSO  Código que os técnicos digitam no formulário. Sem ele, qualquer pessoa
 *                  que descubra a URL /exec consegue gravar na planilha.
 *   EMAIL_COPIA    E-mails separados por vírgula que recebem o PDF de toda OS.
 *   LOGO_FILE_ID   ID de uma imagem no Drive para o cabeçalho do PDF.
 */
const NPC_CONFIG = {
  sheetName: 'Página1',
  logSheetName: 'LOG_ERROS',
  folderName: 'EVIDENCIAS_MANUTENCAO',
  maxFiles: 3,
  maxFileBytes: 4 * 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxTextLength: 2000,
  lockWaitMs: 25000,
  clientes: ['MATRIZ', 'LIFE', 'SUL'],
  tiposEquipamento: ['Split', 'Janela', 'Central'],
  tiposManutencao: ['Preventiva', 'Corretiva'],
  status: ['Concluido', 'Pendente'],
  resultadosChecklist: ['OK', 'Não conforme', 'N/A'],
  mimeTypes: { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' }
};

// As 17 primeiras colunas mantêm a ordem atual da Página1 (o Relatório depende dela).
// As novas entram depois, sem deslocar nada.
const COLUMNS = [
  'Data Registro', 'Cliente', 'Localização Interna', 'Endereço', 'Tipo Equipamento', 'Marca', 'Modelo',
  'Número de Série', 'Data Serviço', 'Tipo Manutenção', 'Descrição Problema', 'Ações Realizadas',
  'Peças Substituídas', 'Status', 'Links das Evidências (Fotos/Vídeos)', 'Parecer Final Técnico',
  'Assinatura do Responsável',
  'Nº da OS', 'ID do Envio', 'Técnico', 'Responsável na Unidade', 'Cargo do Responsável',
  'Hora Início', 'Hora Término', 'Capacidade (BTUs)', 'Gás Refrigerante', 'Checklist PMOC',
  'Medições', 'E-mail da OS', 'PDF da OS'
];
const COL = {};
COLUMNS.forEach(function (name, index) { COL[name] = index + 1; });

/* ------------------------------------------------------------------ */
/* Entradas                                                             */
/* ------------------------------------------------------------------ */

/** GET ?acao=locais devolve os locais já usados por cliente (para sugerir no formulário). */
function doGet(e) {
  const acao = (e && e.parameter && e.parameter.acao) || '';
  if (acao !== 'locais') return response_('ok', 'Serviço ativo.');
  const cache = CacheService.getScriptCache();
  const cached = cache.get('locais_v2');
  if (cached) return response_('ok', 'Locais cadastrados.', JSON.parse(cached));

  const sheet = getSheet_();
  const lastRow = sheet.getLastRow();
  const locais = {};
  NPC_CONFIG.clientes.forEach(function (cliente) { locais[cliente] = {}; });
  if (lastRow > 1) {
    sheet.getRange(2, COL['Cliente'], lastRow - 1, 2).getValues().forEach(function (row) {
      const cliente = String(row[0]).trim();
      const local = String(row[1]).trim().replace(/\s+/g, ' ');
      if (!locais[cliente] || !local) return;
      const key = normalize_(local);
      if (!locais[cliente][key]) locais[cliente][key] = local; // mantém a primeira grafia usada
    });
  }
  const data = {};
  Object.keys(locais).forEach(function (cliente) {
    data[cliente] = Object.keys(locais[cliente]).map(function (k) { return locais[cliente][k]; })
      .sort(function (a, b) { return a.localeCompare(b, 'pt-BR', { numeric: true }); });
  });
  cache.put('locais_v2', JSON.stringify(data), 600);
  return response_('ok', 'Locais cadastrados.', data);
}

function doPost(e) {
  let data;
  try {
    data = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (error) {
    return response_('erro', 'Dados inválidos.');
  }

  // Campo "armadilha" invisível para pessoas: se veio preenchido, é robô. Fingimos sucesso.
  if (value_(data, 'website')) return response_('ok', 'Dados salvos com sucesso.');

  const accessCode = PropertiesService.getScriptProperties().getProperty('CODIGO_ACESSO');
  if (accessCode && value_(data, 'codigo_acesso') !== accessCode) {
    log_('ACESSO', 'Código de acesso inválido de ' + value_(data, 'tecnico_nome'));
    return response_('erro', 'Código de acesso inválido. Confira o código com a coordenação.', null, { codigo: 'acesso' });
  }

  const validationError = validate_(data);
  if (validationError) {
    log_('ERRO', 'Validação falhou: ' + validationError);
    return response_('erro', validationError);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(NPC_CONFIG.lockWaitMs)) {
    return response_('erro', 'Há outros envios em andamento. O formulário vai tentar novamente.', null, { retry: true });
  }

  let record;
  try {
    const sheet = getSheet_();
    ensureHeaders_(sheet);

    // Reenvios (internet caiu no meio, botão tocado duas vezes, fila offline) não duplicam a OS.
    const existing = findBySubmissionId_(sheet, value_(data, 'id_envio'));
    if (existing) return response_('ok', 'Este relatório já estava registrado.', { numero_os: existing, duplicado: true });

    const os = peekOsNumber_();
    const root = getOrCreateFolder_(null, NPC_CONFIG.folderName);
    const folder = getOrCreateFolder_(root, os.numero + ' - ' + value_(data, 'cliente') + ' - ' + value_(data, 'localizacao_interna'));
    const evidenceLinks = saveFiles_(data.arquivos, folder, os.numero);
    const signatureLink = saveSignature_(data.assinatura_responsavel, folder, os.numero);

    const row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1, 1, COLUMNS.length).setValues([[
      new Date(), text_(data, 'cliente'), text_(data, 'localizacao_interna'), text_(data, 'endereco'),
      text_(data, 'tipo_equipamento'), text_(data, 'marca'), text_(data, 'modelo'), text_(data, 'numero_serie'),
      value_(data, 'data_manutencao'), text_(data, 'tipo_manutencao'), text_(data, 'descricao_problema'),
      text_(data, 'acoes_realizadas'), text_(data, 'pecas_substituidas') || 'Nenhuma', text_(data, 'status_servico'),
      evidenceLinks.join('\n'), text_(data, 'parecer_final'), signatureLink,
      os.numero, value_(data, 'id_envio'), text_(data, 'tecnico_nome'), text_(data, 'responsavel_nome'),
      text_(data, 'responsavel_cargo'), value_(data, 'hora_inicio'), value_(data, 'hora_fim'),
      text_(data, 'capacidade_btus'), text_(data, 'gas_refrigerante'), safeCell_(checklistText_(data)),
      safeCell_(medicoesText_(data)), text_(data, 'email_os'), ''
    ]]);
    SpreadsheetApp.flush();
    commitOsNumber_(os);
    CacheService.getScriptCache().remove('locais_v2');
    record = { sheet: sheet, row: row, numeroOs: os.numero, folder: folder, evidencias: evidenceLinks.length };
  } catch (error) {
    log_('ERRO', (error && error.stack) || String(error));
    return response_('erro', 'Erro ao processar o envio: ' + error.message);
  } finally {
    lock.releaseLock();
  }

  // PDF e e-mail ficam fora do lock: são lentos e uma falha aqui não deve perder o registro.
  let emailCount = 0;
  let pdfOk = false;
  try {
    const pdf = createPdf_(data, record.numeroOs, record.folder);
    record.sheet.getRange(record.row, COL['PDF da OS']).setValue(pdf.getUrl());
    pdfOk = true;
    emailCount = sendEmail_(data, record.numeroOs, pdf.getBlob());
  } catch (error) {
    log_('AVISO', 'PDF/e-mail da ' + record.numeroOs + ': ' + ((error && error.stack) || error));
  }

  return response_('ok', 'Dados salvos com sucesso.', {
    numero_os: record.numeroOs, evidencias: record.evidencias, pdf: pdfOk, email_enviado: emailCount
  });
}

/* ------------------------------------------------------------------ */
/* Validação                                                            */
/* ------------------------------------------------------------------ */

function validate_(data) {
  const required = {
    id_envio: 'ID do envio', tecnico_nome: 'Técnico', cliente: 'Cliente', localizacao_interna: 'Localização',
    endereco: 'Endereço', tipo_equipamento: 'Tipo de equipamento', marca: 'Marca', modelo: 'Modelo',
    data_manutencao: 'Data do serviço', hora_inicio: 'Hora de início', hora_fim: 'Hora de término',
    tipo_manutencao: 'Tipo de manutenção', descricao_problema: 'Descrição do problema',
    acoes_realizadas: 'Ações realizadas', parecer_final: 'Parecer final', status_servico: 'Status',
    responsavel_nome: 'Responsável na unidade', assinatura_responsavel: 'Assinatura'
  };
  for (const key in required) {
    if (!value_(data, key)) return 'Campo obrigatório ausente: ' + required[key];
  }
  if (!/^[\w-]{8,64}$/.test(value_(data, 'id_envio'))) return 'ID do envio inválido.';
  if (NPC_CONFIG.clientes.indexOf(value_(data, 'cliente')) === -1) return 'Cliente inválido.';
  if (NPC_CONFIG.tiposEquipamento.indexOf(value_(data, 'tipo_equipamento')) === -1) return 'Tipo de equipamento inválido.';
  if (NPC_CONFIG.tiposManutencao.indexOf(value_(data, 'tipo_manutencao')) === -1) return 'Tipo de manutenção inválido.';
  if (NPC_CONFIG.status.indexOf(value_(data, 'status_servico')) === -1) return 'Status inválido.';

  const date = value_(data, 'data_manutencao');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Data de manutenção inválida.';
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 86400000), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  if (date > tomorrow) return 'A data do serviço não pode ser no futuro.';

  const start = value_(data, 'hora_inicio');
  const end = value_(data, 'hora_fim');
  if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) return 'Horário inválido.';
  if (end < start) return 'O horário de término deve ser depois do início.';

  const email = value_(data, 'email_os');
  if (email && !isEmail_(email)) return 'E-mail para envio da OS inválido.';

  if (!Array.isArray(data.arquivos) || !data.arquivos.length) return 'Anexe pelo menos uma evidência.';
  if (data.arquivos.length > NPC_CONFIG.maxFiles) return 'Quantidade de evidências excedida.';
  for (let i = 0; i < data.arquivos.length; i++) {
    if (!NPC_CONFIG.mimeTypes[data.arquivos[i] && data.arquivos[i].type]) return 'Formato de arquivo não aceito.';
  }
  if (!/^data:image\/png;base64,/.test(value_(data, 'assinatura_responsavel'))) return 'Assinatura inválida.';

  if (value_(data, 'tipo_manutencao') === 'Preventiva') {
    if (!Array.isArray(data.checklist) || !data.checklist.length) return 'Preencha o checklist da preventiva.';
    for (let j = 0; j < data.checklist.length; j++) {
      if (NPC_CONFIG.resultadosChecklist.indexOf(String(data.checklist[j] && data.checklist[j].resultado)) === -1) {
        return 'Checklist incompleto.';
      }
    }
  }
  return '';
}

/* ------------------------------------------------------------------ */
/* Planilha                                                             */
/* ------------------------------------------------------------------ */

function getSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName(NPC_CONFIG.sheetName);
  if (!sheet) throw new Error('Aba "' + NPC_CONFIG.sheetName + '" não encontrada na planilha.');
  return sheet;
}

/** Escreve o nome das colunas novas na linha 1, sem tocar nas existentes. */
function ensureHeaders_(sheet) {
  if (sheet.getMaxColumns() < COLUMNS.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), COLUMNS.length - sheet.getMaxColumns());
  }
  const header = sheet.getRange(1, 1, 1, COLUMNS.length);
  const current = header.getValues()[0];
  if (current[0] instanceof Date) return; // planilha sem linha de cabeçalho: não mexer
  let changed = false;
  for (let i = 0; i < COLUMNS.length; i++) {
    if (!current[i]) { current[i] = COLUMNS[i]; changed = true; }
  }
  if (changed) header.setValues([current]);
}

function findBySubmissionId_(sheet, id) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return '';
  const cell = sheet.getRange(2, COL['ID do Envio'], lastRow - 1, 1)
    .createTextFinder(id).matchEntireCell(true).findNext();
  return cell ? String(sheet.getRange(cell.getRow(), COL['Nº da OS']).getValue()) : '';
}

/** Numeração anual: OS-2026-0001. Só é confirmada depois que a linha foi gravada. */
function peekOsNumber_() {
  const year = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
  const key = 'OS_SEQ_' + year;
  const seq = Number(PropertiesService.getScriptProperties().getProperty(key) || 0) + 1;
  return { key: key, seq: seq, numero: 'OS-' + year + '-' + String(seq).padStart(4, '0') };
}

function commitOsNumber_(os) {
  PropertiesService.getScriptProperties().setProperty(os.key, String(os.seq));
}

function log_(type, message) {
  console.error(type + ': ' + message);
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NPC_CONFIG.logSheetName);
    if (sheet) sheet.appendRow([new Date(), type, String(message).slice(0, 5000)]);
  } catch (error) { /* o log nunca deve derrubar o envio */ }
}

/* ------------------------------------------------------------------ */
/* Drive                                                                */
/* ------------------------------------------------------------------ */

function getOrCreateFolder_(parent, name) {
  const folders = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}

function saveFiles_(files, folder, numeroOs) {
  let total = 0;
  return files.map(function (file, index) {
    const base64 = extractBase64_(file.base64);
    const estimatedBytes = Math.floor(base64.length * 0.75);
    if (estimatedBytes > NPC_CONFIG.maxFileBytes) throw new Error('Arquivo ' + (index + 1) + ' excede o tamanho permitido.');
    total += estimatedBytes;
    if (total > NPC_CONFIG.maxTotalBytes) throw new Error('O total das evidências excede o tamanho permitido.');
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), file.type,
      numeroOs + '_evidencia_' + (index + 1) + NPC_CONFIG.mimeTypes[file.type]);
    return folder.createFile(blob).getUrl();
  });
}

function saveSignature_(dataUrl, folder, numeroOs) {
  const blob = Utilities.newBlob(Utilities.base64Decode(extractBase64_(dataUrl)), 'image/png', numeroOs + '_assinatura.png');
  return folder.createFile(blob).getUrl();
}

/* ------------------------------------------------------------------ */
/* PDF e e-mail                                                         */
/* ------------------------------------------------------------------ */

function createPdf_(data, numeroOs, folder) {
  const html = buildPdfHtml_(data, numeroOs);
  const pdf = Utilities.newBlob(html, 'text/html', numeroOs + '.html').getAs('application/pdf')
    .setName(numeroOs + ' - ' + value_(data, 'cliente') + ' - ' + value_(data, 'localizacao_interna') + '.pdf');
  return folder.createFile(pdf);
}

function buildPdfHtml_(data, numeroOs) {
  const v = function (key) { return esc_(value_(data, key)); };
  const row = function (label, content) { return '<tr><th>' + label + '</th><td>' + (content || '—') + '</td></tr>'; };
  const multiline = function (key) { return v(key).replace(/\n/g, '<br>'); };
  const dataServico = value_(data, 'data_manutencao').split('-').reverse().join('/');
  const emitido = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy 'às' HH:mm");
  const status = value_(data, 'status_servico') === 'Concluido' ? 'Concluído' : 'Pendente';

  let logo = '';
  const logoId = PropertiesService.getScriptProperties().getProperty('LOGO_FILE_ID');
  if (logoId) {
    try {
      const blob = DriveApp.getFileById(logoId).getBlob();
      logo = '<img class="logo" src="data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) + '">';
    } catch (error) { log_('AVISO', 'Logo do PDF: ' + error.message); }
  }

  let checklist = '';
  if (Array.isArray(data.checklist) && data.checklist.length) {
    checklist = '<h2>Checklist de manutenção preventiva (PMOC)</h2><table class="grid">' +
      data.checklist.map(function (item) {
        const result = esc_(item.resultado);
        const cls = item.resultado === 'OK' ? 'ok' : item.resultado === 'Não conforme' ? 'nok' : 'na';
        return '<tr><td>' + esc_(item.item) + '</td><td class="' + cls + '">' + result + '</td></tr>';
      }).join('') + '</table>';
  }
  let medicoes = '';
  if (Array.isArray(data.medicoes) && data.medicoes.length) {
    medicoes = '<h2>Medições</h2><table class="grid">' + data.medicoes.map(function (m) {
      return '<tr><td>' + esc_(m.item) + '</td><td>' + esc_(m.valor) + ' ' + esc_(m.unidade) + '</td></tr>';
    }).join('') + '</table>';
  }

  const fotos = (data.arquivos || []).filter(function (f) { return /^data:image\/(jpeg|png|webp);base64,/.test(String(f.base64)); })
    .map(function (f) { return '<img class="foto" src="' + f.base64 + '">'; }).join('');
  const videos = (data.arquivos || []).filter(function (f) { return String(f.type).indexOf('video/') === 0; }).length;

  return '<html><head><meta charset="utf-8"><style>' +
    'body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;margin:24px}' +
    '.top{border-bottom:3px solid #0d9488;padding-bottom:8px;margin-bottom:12px}' +
    '.logo{height:48px;float:left;margin-right:12px}' +
    'h1{font-size:18px;margin:0;color:#0d9488}.sub{color:#64748b;margin-top:2px}' +
    '.os{float:right;text-align:right;font-size:13px;font-weight:bold}' +
    'h2{font-size:12px;color:#0d9488;text-transform:uppercase;margin:16px 0 6px;border-bottom:1px solid #e2e8f0;padding-bottom:3px}' +
    'table{width:100%;border-collapse:collapse}th{text-align:left;width:32%;color:#64748b;font-weight:bold;padding:4px 6px;vertical-align:top}' +
    'td{padding:4px 6px;vertical-align:top}.grid td{border:1px solid #e2e8f0}' +
    '.ok{color:#15803d;font-weight:bold}.nok{color:#b91c1c;font-weight:bold}.na{color:#64748b}' +
    '.foto{width:31%;margin:0 1% 8px 0;border:1px solid #e2e8f0}' +
    '.assinatura{height:90px;border-bottom:1px solid #1e293b}' +
    '.rodape{margin-top:20px;color:#94a3b8;font-size:9px;text-align:center}' +
    '</style></head><body>' +
    '<div class="top">' + logo + '<div class="os">' + esc_(numeroOs) + '<br><span class="sub">' + dataServico + '</span></div>' +
    '<h1>Ordem de Serviço — Ar Condicionado</h1><div class="sub">NPC Neuropsicocentro · Manutenção</div><div style="clear:both"></div></div>' +
    '<h2>Local</h2><table>' + row('Cliente', v('cliente')) + row('Endereço', v('endereco')) + row('Localização', v('localizacao_interna')) + '</table>' +
    '<h2>Equipamento</h2><table>' + row('Tipo', v('tipo_equipamento')) + row('Marca / Modelo', v('marca') + ' / ' + v('modelo')) +
    row('Nº de série', v('numero_serie')) + row('Capacidade', v('capacidade_btus') ? v('capacidade_btus') + ' BTUs' : '') +
    row('Gás refrigerante', v('gas_refrigerante')) + '</table>' +
    '<h2>Serviço</h2><table>' + row('Tipo de manutenção', v('tipo_manutencao')) +
    row('Data e horário', dataServico + ', das ' + v('hora_inicio') + ' às ' + v('hora_fim')) + row('Técnico', v('tecnico_nome')) +
    row('Problema / estado inicial', multiline('descricao_problema')) + row('Ações realizadas', multiline('acoes_realizadas')) +
    row('Peças substituídas', v('pecas_substituidas') || 'Nenhuma') + '</table>' +
    checklist + medicoes +
    '<h2>Parecer técnico</h2><table>' + row('Parecer', multiline('parecer_final')) + row('Status final', status) + '</table>' +
    (fotos ? '<h2>Evidências</h2>' + fotos : '') +
    (videos ? '<p class="sub">' + videos + ' vídeo(s) arquivado(s) na pasta da OS no Drive.</p>' : '') +
    '<h2>Aceite do responsável na unidade</h2><table><tr><td style="width:50%">' +
    '<img class="assinatura" src="' + value_(data, 'assinatura_responsavel') + '"><br>' + v('responsavel_nome') +
    (v('responsavel_cargo') ? ' — ' + v('responsavel_cargo') : '') + '</td><td></td></tr></table>' +
    '<div class="rodape">Documento gerado automaticamente em ' + emitido + ' · ' + esc_(numeroOs) + '</div>' +
    '</body></html>';
}

function sendEmail_(data, numeroOs, pdfBlob) {
  const copies = (PropertiesService.getScriptProperties().getProperty('EMAIL_COPIA') || '').split(',');
  const recipients = [value_(data, 'email_os')].concat(copies)
    .map(function (email) { return String(email).trim().toLowerCase(); })
    .filter(function (email, index, list) { return isEmail_(email) && list.indexOf(email) === index; });
  if (!recipients.length) return 0;
  const status = value_(data, 'status_servico') === 'Concluido' ? 'Concluído' : 'Pendente';
  MailApp.sendEmail({
    to: recipients.join(','),
    subject: numeroOs + ' · ' + value_(data, 'cliente') + ' · ' + value_(data, 'localizacao_interna') + ' (' + status + ')',
    htmlBody: '<p>Segue em anexo a Ordem de Serviço <b>' + esc_(numeroOs) + '</b> referente à manutenção ' +
      esc_(value_(data, 'tipo_manutencao').toLowerCase()) + ' do ar condicionado em <b>' + esc_(value_(data, 'localizacao_interna')) +
      '</b> (' + esc_(value_(data, 'cliente')) + ').</p><p>Status: <b>' + status + '</b></p>' +
      '<p style="color:#64748b;font-size:12px">Mensagem automática do sistema NPC Manutenção.</p>',
    attachments: [pdfBlob],
    name: 'NPC Manutenção'
  });
  return recipients.length;
}

/* ------------------------------------------------------------------ */
/* Utilitários                                                          */
/* ------------------------------------------------------------------ */

function checklistText_(data) {
  if (!Array.isArray(data.checklist)) return '';
  return data.checklist.map(function (item) { return String(item.item) + ': ' + String(item.resultado); }).join('\n');
}

function medicoesText_(data) {
  if (!Array.isArray(data.medicoes)) return '';
  return data.medicoes.map(function (m) { return String(m.item) + ': ' + String(m.valor) + ' ' + String(m.unidade); }).join('\n');
}

function value_(data, key) { return String((data && data[key]) || '').trim(); }

/** Texto seguro para célula: limita tamanho e impede que "=..." vire fórmula na planilha. */
function text_(data, key) { return safeCell_(value_(data, key).slice(0, NPC_CONFIG.maxTextLength)); }
function safeCell_(text) { return /^[=+\-@]/.test(text) ? "'" + text : text; }

function extractBase64_(dataUrl) { return String(dataUrl || '').split(',').pop(); }
function isEmail_(email) { return /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(email); }
/** Chave para comparar locais: ignora acentos, espaços, pontuação e zeros à esquerda ("Sala 02" = "sala 2"). */
function normalize_(text) {
  return String(text).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '').replace(/(^|\D)0+(\d)/g, '$1$2');
}
function esc_(text) {
  return String(text == null ? '' : text).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function response_(status, message, data, extra) {
  const body = { status: status, message: message, data: data || null };
  Object.keys(extra || {}).forEach(function (key) { body[key] = extra[key]; });
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
