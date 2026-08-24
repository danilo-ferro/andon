# -*- coding: utf-8 -*-
"""Transforma a BASE CONSOLIDADA em arquivos .psv para /dados.

A planilha é a fonte da verdade do histórico. Aqui só se traduz: nomes de
pessoa para a forma canônica, códigos curtos (PRÉ, LN) para o que o sistema
mostra, e datas para ISO. Nada é inventado nem descartado em silêncio — o que
não couber aparece no relatório do fim.
"""
import openpyxl, datetime, collections, unicodedata, sys, os, re

ARQ = sys.argv[1] if len(sys.argv) > 1 else 'BASE_ANDON_ACORDOS_2026_CONSOLIDADA.xlsx'
SAIDA = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'dados') + os.sep

wb = openpyxl.load_workbook(ARQ, data_only=True)

def tabela(nome):
    ws = wb[nome]
    L = list(ws.iter_rows(values_only=True))
    cab = [str(c or '').strip() for c in L[0]]
    return [dict(zip(cab, r)) for r in L[1:]]

ACORDOS = tabela('ACORDOS')
DESMEMBR = tabela('DESMEMBRAMENTO VALORES')
RECEB = tabela('RECEBIMENTOS')
TRAT = tabela('TRATATIVAS')

alertas = collections.Counter()

# ---------------------------------------------------------------- utilidades
def txt(v):
    if v is None:
        return ''
    s = str(v).strip()
    # A barra vertical separa campos no .psv: dentro do texto ela quebraria a
    # linha inteira. O histórico de OBS usa " | " o tempo todo.
    return s.replace('|', '/').replace('\n', ' ').replace('\r', ' ')

def data(v):
    if v is None or v == '':
        return ''
    if isinstance(v, datetime.datetime):
        return v.date().isoformat()
    if isinstance(v, datetime.date):
        return v.isoformat()
    s = str(v).strip()
    m = re.match(r'^(\d{4})-(\d{2})-(\d{2})', s)
    if m:
        return m.group(0)
    m = re.match(r'^(\d{2})/(\d{2})/(\d{4})$', s)
    if m:
        return f'{m.group(3)}-{m.group(2)}-{m.group(1)}'
    alertas['data_ilegivel:' + s[:20]] += 1
    return ''

def numero(v):
    if v is None or v == '':
        return ''
    if isinstance(v, (int, float)):
        return f'{float(v):.2f}'
    s = str(v).strip().replace('R$', '').replace(' ', '')
    if not s:
        return ''
    if ',' in s and '.' in s:
        s = s.replace('.', '').replace(',', '.')
    elif ',' in s:
        s = s.replace(',', '.')
    try:
        return f'{float(s):.2f}'
    except ValueError:
        alertas['valor_ilegivel:' + s[:20]] += 1
        return ''

def inteiro(v):
    if v is None or v == '':
        return ''
    try:
        return str(int(float(v)))
    except (ValueError, TypeError):
        return ''

def chave(s):
    s = unicodedata.normalize('NFD', str(s or '')).encode('ascii', 'ignore').decode()
    return re.sub(r'[^A-Z0-9]', '', s.upper())

# ------------------------------------------------------------------- pessoas
# Nome curto da planilha -> nome completo no cadastro. ALANA vira MAX porque os
# processos dela são do Max — foi o Danilo quem disse, e vale para os que ainda
# aparecerem.
ADVOGADOS = {
    'MAX': 'Max Canaverde', 'ALANA': 'Max Canaverde',
    'MARIAH': 'Mariah Aguiar', 'JEZIELI': 'Jezieli Franco',
    'YUNES': 'Yunes Kaled', 'KALED': 'Kaled Kassem',
    'ISABELLE': 'Isabelle Alencar', 'GLEI': 'Gleisy Santana',
    'GLEISY': 'Gleisy Santana', 'DEBORAH': 'Déborah Lisboa',
    'FELIPE': 'Felipe',
}
# Sobrenome so entra aqui quando alguem informou. A planilha traz o primeiro
# nome; completar por conta propria e inventar dado num sistema de registro.
OPERADORES = {
    'LIGIA': 'Lígia Cipriano', 'NATHALIA': 'Nathalia Gomes',
    'GABRIELY': 'Gabriely Mota', 'JENIFER': 'Jenifer Alves',
    'IRIS': 'Iris Pereira', 'FERNANDA': 'Fernanda Simões',
    'EDUARDHA': 'Eduardha Mendez', 'RAFAELA': 'Rafaela Santos',
    'DANILO': 'Danilo Ferro',
}

def pessoa(v, mapa, onde):
    s = txt(v).upper()
    if not s:
        return ''
    k = chave(s)
    for curto, completo in mapa.items():
        if chave(curto) == k:
            return completo
    # já veio por extenso?
    for completo in set(mapa.values()):
        if chave(completo) == k:
            return completo
    alertas[f'{onde}_desconhecido:{s}'] += 1
    return txt(v)

# --------------------------------------------------------- listas do sistema
FASE = {'PRÉ': 'Pré-sentença', 'PRE': 'Pré-sentença',
        'PÓS': 'Pós-sentença', 'POS': 'Pós-sentença',
        'PÓS-ACÓRDÃO': 'Pós-acórdão'}
PRODUTO = {'LN': 'Limpa Nome (LN)', 'CCS': 'CCS', 'SCR': 'SCR',
           'BANCÁRIOS': 'Bancários / Golpes', 'BANCARIOS': 'Bancários / Golpes',
           'ESTRATÉGICO': 'Estratégico', 'ESTRATEGICO': 'Estratégico',
           'TRABALHISTA': 'Trabalhista'}
CANAL = {'E-MAIL', 'WHATSAPP', 'TELEFONE', 'AUDIÊNCIA', 'AUTOS', 'NÃO APTO'}
STATUS = {'AGUARDANDO RETORNO', 'EM TRATATIVA', 'ACORDO FECHADO', 'RECUSADO',
          'SEM RETORNO', 'AGUARDANDO AUDIÊNCIA', 'AGUARD. CONTESTAÇÃO',
          'AGUARDANDO RECURSO', 'MLE', 'EM EXECUÇÃO', 'IMPROCEDENTE'}
TIPO = {'ATIVO', 'PASSIVO', 'TRABALHISTA'}

def de_lista(v, mapa, conjunto, onde, padrao=''):
    s = txt(v).upper()
    if not s:
        return padrao
    if mapa and s in mapa:
        return mapa[s]
    if mapa:
        for k, val in mapa.items():
            if chave(k) == chave(s):
                return val
    if conjunto:
        for k in conjunto:
            if chave(k) == chave(s):
                return k
    alertas[f'{onde}_fora_da_lista:{s}'] += 1
    return padrao

# =====================================================================
# 1. TRATATIVAS
# =====================================================================
# Cada ID_ACORDO aponta para um acordo fechado. Quando o mesmo ID aparece em
# duas tratativas (a tentativa que falhou e a que fechou), o cabeçalho
# financeiro gruda numa só: a que está fechada e tem valor.
por_id = collections.defaultdict(list)
for i, r in enumerate(TRAT):
    if r.get('ID_ACORDO'):
        por_id[str(r['ID_ACORDO']).strip()].append(i)

dona_do_acordo = {}
for idac, linhas in por_id.items():
    def peso(i):
        r = TRAT[i]
        fechada = 1 if txt(r['STATUS']).upper() == 'ACORDO FECHADO' else 0
        temvalor = 1 if numero(r['VALOR']) else 0
        return (fechada, temvalor, data(r['DATA']))
    dona_do_acordo[idac] = max(linhas, key=peso)

ACORDO_POR_ID = {str(r['ID_ACORDO']).strip(): r for r in ACORDOS}

def linha_tratativa(r, idac, acordo, principal=True):
    """Uma linha de tratativa.psv. `acordo` só vem preenchido na linha dona."""
    d = data(r.get('DATA'))
    dmin = data(r.get('DATA MINUTA'))
    dprot = data(r.get('DATA PROTOCOLO'))
    drec = data(r.get('DATA RECEBIMENTO'))
    prev = data(r.get('PREVISÃO'))
    valor = numero(r.get('VALOR'))
    parcelado, qtd = '', ''

    if acordo:
        # Onde a planilha de tratativas não trouxe, o cabeçalho do acordo traz.
        valor = valor or numero(acordo.get('VALOR ACORDO'))
        dprot = dprot or data(acordo.get('DATA PROTOCOLO'))
        prev = prev or data(acordo.get('PREVISÃO'))
        d = d or data(acordo.get('DATA ACORDO'))
        parcelado = 'parcelado' if txt(acordo.get('PARCELADO')).upper() == 'SIM' else 'unica'
        qtd = inteiro(acordo.get('QTD PARCELAS')) if parcelado == 'parcelado' else ''

    recebido = 'true' if txt(r.get('RECEBIDO')).upper() == 'SIM' else \
               ('true' if acordo and txt(acordo.get('SITUAÇÃO FINANCEIRA')).upper() == 'QUITADO' else 'false')

    # A última data conhecida é o que faz o contador de "parado há" dizer a
    # verdade. Sem isso toda tratativa antiga apareceria como recém-mexida.
    atualizacao = max([x for x in (d, dmin, dprot, drec) if x] or [''])

    return [
        idac,
        de_lista(r.get('FASE'), FASE, None, 'fase'),
        txt(r.get('ESTADO')).upper()[:2],
        pessoa(r.get('ADV'), ADVOGADOS, 'advogado'),
        txt(r.get('PROCESSO')),
        txt(r.get('AUTOR')),
        txt(r.get('RÉU')),
        txt(r.get('ESCRITÓRIO (ADV. RÉU)')),
        de_lista(r.get('FORMA DE CONTATO'), None, CANAL, 'canal'),
        pessoa(r.get('OPERADOR'), OPERADORES, 'operador'),
        d,
        de_lista(r.get('STATUS'), None, STATUS, 'status', 'AGUARDANDO RETORNO'),
        txt(r.get('OBS')),
        de_lista(r.get('TIPO') or (acordo or {}).get('TIPO'), None, TIPO, 'tipo'),
        de_lista(r.get('PRODUTO') or (acordo or {}).get('PRODUTO'), PRODUTO, None, 'produto'),
        dmin, valor, dprot, prev, recebido, drec, atualizacao,
        parcelado, qtd,
        # Um mesmo acordo às vezes foi anotado em duas tentativas. As duas
        # ficam no histórico, mas só uma conta como acordo — senão 238 acordos
        # virariam 241 no painel.
        'true' if principal else 'false',
    ]

linhas_trat = []
for i, r in enumerate(TRAT):
    idac = str(r['ID_ACORDO']).strip() if r.get('ID_ACORDO') else ''
    dona = idac and dona_do_acordo.get(idac) == i
    linhas_trat.append(linha_tratativa(r, idac,
                                       ACORDO_POR_ID.get(idac) if dona else None,
                                       principal=bool(dona) or not idac))

# Seis acordos existem só no ADVBox: viraram tratativa fechada, senão o
# dinheiro deles ficaria sem dono na tela.
sem_tratativa = [r for r in ACORDOS if str(r['ID_ACORDO']).strip() not in por_id]
for a in sem_tratativa:
    idac = str(a['ID_ACORDO']).strip()
    falsa = {
        'FASE': a.get('FASE'), 'ESTADO': a.get('ESTADO'), 'ADV': a.get('ADV'),
        'PROCESSO': a.get('PROCESSO'), 'AUTOR': a.get('AUTOR'), 'RÉU': a.get('RÉU'),
        'ESCRITÓRIO (ADV. RÉU)': a.get('ESCRITÓRIO (ADV. RÉU)'),
        'FORMA DE CONTATO': '', 'OPERADOR': '',
        'DATA': a.get('DATA ACORDO'), 'STATUS': 'ACORDO FECHADO',
        'OBS': txt(a.get('OBS (HISTÓRICO)')) or 'Acordo importado do ADVBox — sem registro de tratativa.',
        'TIPO': a.get('TIPO'), 'PRODUTO': a.get('PRODUTO'),
        'DATA MINUTA': '', 'VALOR': a.get('VALOR ACORDO'),
        'DATA PROTOCOLO': a.get('DATA PROTOCOLO'), 'PREVISÃO': a.get('PREVISÃO'),
        'RECEBIDO': '', 'DATA RECEBIMENTO': '',
    }
    linhas_trat.append(linha_tratativa(falsa, idac, a))


# =====================================================================
# UM PROCESSO, UMA TRATATIVA
# =====================================================================
# A planilha anota cada nova tentativa como uma linha nova: o mesmo processo
# aparece duas, tres vezes, com "1a TENTATIVA", "2a TENTATIVA" nas observacoes.
# Isso duplicava o caso na esteira, contava duas tratativas onde houve uma e,
# quando as duas estavam fechadas, somava o mesmo acordo duas vezes.
#
# O historico nao se perde: ele ja mora nas observacoes, e a fusao junta as de
# todas as linhas em ordem de data. A data da 1a tentativa vira a mais antiga
# do grupo e a ultima atualizacao a mais recente — que e o que o tempo de
# encerramento precisa para dizer a verdade.
#
# A mesma regra existe no banco (migracao um_processo_uma_tratativa) para o
# que ja estava carregado. Aqui ela evita que a proxima carga traga de volta.
IDX = {'id_acordo': 0, 'fase': 1, 'estado': 2, 'advogado': 3, 'processo': 4,
       'autor': 5, 'reu': 6, 'escritorio': 7, 'canal': 8, 'operador': 9,
       'data': 10, 'status': 11, 'obs': 12, 'tipo': 13, 'produto': 14,
       'minuta': 15, 'valor': 16, 'protocolo': 17, 'previsao': 18,
       'recebido': 19, 'recebimento': 20, 'atualizacao': 21,
       'forma': 22, 'parcelas': 23, 'principal': 24}

def digitos(p):
    return re.sub(r'[^0-9]', '', str(p or ''))

def funde(grupo):
    """Uma linha so, a partir das varias do mesmo processo."""
    # Manda o lancamento mais atualizado: e ele que diz onde o caso esta hoje.
    # Uma tratativa fechada em fevereiro que voltou a ser negociada em agosto
    # nao esta fechada — o registro de agosto e a verdade.
    def peso(l):
        return (l[IDX['atualizacao']] or l[IDX['data']] or '',
                l[IDX['data']] or '',
                1 if l[IDX['valor']] else 0)
    fica = max(grupo, key=peso)[:]

    # Onde a vencedora nao tem, a mais recente das outras completa.
    for campo in ('id_acordo', 'fase', 'estado', 'advogado', 'autor', 'reu',
                  'escritorio', 'canal', 'operador', 'tipo', 'produto',
                  'minuta', 'valor', 'protocolo', 'previsao', 'recebimento',
                  'forma', 'parcelas'):
        i = IDX[campo]
        if not fica[i]:
            for l in sorted(grupo, key=lambda x: x[IDX['data']] or '', reverse=True):
                if l[i]:
                    fica[i] = l[i]
                    break

    datas = [l[IDX['data']] for l in grupo if l[IDX['data']]]
    fica[IDX['data']] = min(datas) if datas else ''
    atus = [l[IDX['atualizacao']] or l[IDX['data']] for l in grupo
            if l[IDX['atualizacao']] or l[IDX['data']]]
    fica[IDX['atualizacao']] = max(atus) if atus else ''

    # Historico junto, em ordem de data, sem repetir o que ja estava escrito.
    vistos, obs = set(), []
    for l in sorted(grupo, key=lambda x: x[IDX['data']] or ''):
        o = (l[IDX['obs']] or '').strip()
        if o and o not in vistos:
            vistos.add(o)
            obs.append(o)
    fica[IDX['obs']] = ' / '.join(obs)

    fica[IDX['principal']] = 'true'
    return fica

grupos = collections.OrderedDict()
for l in linhas_trat:
    d = digitos(l[IDX['processo']]) or ('sem-numero-' + str(len(grupos)))
    grupos.setdefault(d, []).append(l)

antes = len(linhas_trat)
fundidos = sum(1 for g in grupos.values() if len(g) > 1)
linhas_trat = [g[0] if len(g) == 1 else funde(g) for g in grupos.values()]

# =====================================================================
# 2. DESMEMBRAMENTO (verbas)
# =====================================================================
VERBAS = {'DM', 'HS', 'DM+HS', 'TRABALHISTA', 'OUTROS'}
linhas_verba = []
for r in DESMEMBR:
    v = txt(r['VERBA']).upper()
    if v not in VERBAS:
        alertas['verba_fora_da_lista:' + v] += 1
    linhas_verba.append([
        txt(r['ID_ACORDO']), txt(r['PROCESSO']), v, txt(r['DETALHE DA VERBA']),
        inteiro(r['QTD LANÇAMENTOS']), numero(r['VALOR PAGO']),
        numero(r['VALOR EM ABERTO']), numero(r['VALOR TOTAL']),
    ])

# =====================================================================
# 3. RECEBIMENTOS
# =====================================================================
SITUACAO = {'PAGO', 'EM ATRASO', 'A VENCER'}
linhas_receb = []
for r in RECEB:
    s = txt(r['SITUAÇÃO']).upper()
    if s not in SITUACAO:
        alertas['situacao_fora_da_lista:' + s] += 1
    linhas_receb.append([
        txt(r['ID_ACORDO']), txt(r['PROCESSO']), txt(r['CATEGORIA ADVBOX']),
        de_lista(r.get('TIPO'), None, TIPO, 'tipo_receb'),
        de_lista(r.get('FASE'), FASE, None, 'fase_receb'),
        txt(r['VERBA']).upper(), txt(r['DETALHE DA VERBA']),
        txt(r['PARCELA']), inteiro(r['Nº PARCELA']), inteiro(r['TOTAL PARCELAS']),
        data(r['VENCIMENTO']), txt(r['COMPETÊNCIA']), data(r['DATA PAGAMENTO']),
        s, numero(r['VALOR']), pessoa(r.get('ADV'), ADVOGADOS, 'advogado_receb'),
        txt(r['DESCRIÇÃO ORIGINAL (ADVBOX)']),
    ])

# =====================================================================
def grava(nome, linhas, colunas):
    caminho = SAIDA + nome
    with open(caminho, 'w', encoding='utf-8') as f:
        for l in linhas:
            if len(l) != colunas:
                raise SystemExit(f'{nome}: linha com {len(l)} campos, esperado {colunas}')
            f.write('|'.join(l) + '\n')
    print(f'{nome:26} {len(linhas):>5} linhas x {colunas} campos')

grava('tratativa.psv', linhas_trat, 25)
grava('acordo_verba.psv', linhas_verba, 8)
grava('acordo_recebimento.psv', linhas_receb, 17)

print()
print('tratativas da planilha :', len(TRAT))
print('acordos sem tratativa  :', len(sem_tratativa))
print('total gravado          :', len(linhas_trat))
print('linhas com id_acordo   :', sum(1 for l in linhas_trat if l[0]))
print('processos repetidos    :', fundidos, f'({antes - len(linhas_trat)} linhas fundidas)')
print('acordos principais     :', sum(1 for l in linhas_trat if l[0] and l[24] == 'true'))
print('repeticoes de acordo   :', sum(1 for l in linhas_trat if l[0] and l[24] == 'false'))
print('fechadas que contam    :', sum(1 for l in linhas_trat if l[11] == 'ACORDO FECHADO' and l[24] == 'true'))
print()
if alertas:
    print('--- pontos de atencao ---')
    for k, v in alertas.most_common(40):
        print(f'  {v:>4}x {k}')
else:
    print('nenhum alerta')
