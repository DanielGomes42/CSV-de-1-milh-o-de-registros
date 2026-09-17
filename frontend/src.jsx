// Importa o React e dois Hooks:
//
// useState: armazena dados dentro do componente.
// useEffect: executa alguma ação depois da renderização.
import React, { useEffect, useState } from 'react';

// Importa a função que conecta o React ao elemento HTML da página.
import { createRoot } from 'react-dom/client';

// Importa os estilos CSS utilizados pelo componente.
import './style.css';

/*
 * Função auxiliar para chamar a API.
 *
 * path: endereço que será acrescentado depois de "/api".
 * options: configurações opcionais do fetch, como método e body.
 *
 * Exemplo:
 * api('/transactions')
 *
 * Resultado:
 * fetch('/api/transactions')
 */
const api = (path, options) =>
  fetch(`/api${path}`, options).then((response) => {
    // response.ok será true para respostas HTTP entre 200 e 299.
    if (response.ok) {
      // Converte a resposta da API de JSON para objeto JavaScript.
      return response.json();
    }

    // Se a API retornar erro, lê a mensagem como texto.
    return response.text().then((message) => {
      // Interrompe a Promise e envia a mensagem para o .catch().
      return Promise.reject(message);
    });
  });

/*
 * Cria um formatador de dinheiro.
 *
 * Exemplo:
 * money.format(1500)
 *
 * Resultado:
 * R$ 1.500,00
 */
const money = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

function App() {
  /*
   * Guarda as informações da importação atual.
   *
   * Começa como null porque ainda não existe uma importação.
   */
  const [job, setJob] = useState(null);

  /*
   * Guarda as 30 transações mostradas na tabela.
   *
   * Começa como um array vazio.
   */
  const [rows, setRows] = useState([]);

  /*
   * Guarda os cursores utilizados na paginação.
   *
   * O cursor funciona como uma referência que indica à API
   * a partir de qual transação ela deve continuar a busca.
   *
   * A primeira página não precisa de cursor, por isso começa com null.
   */
  const [cursors, setCursors] = useState([null]);

  /*
   * Indica qual página ou lote está sendo exibido.
   *
   * 0 = primeira página
   * 1 = segunda página
   * 2 = terceira página
   */
  const [cursorIndex, setCursorIndex] = useState(0);

  /*
   * Cursor da próxima página retornado pela API.
   *
   * Quando estiver vazio, significa que não existe uma próxima página.
   */
  const [nextCursor, setNextCursor] = useState('');

  /*
   * Guarda os dados agregados por mês e categoria.
   *
   * Exemplo de um item:
   * {
   *   month: '2026-01',
   *   category: 'food',
   *   total: 5000,
   *   count: 100
   * }
   */
  const [agg, setAgg] = useState([]);

  /*
   * Guarda as informações sobre a capacidade do banco.
   *
   * Exemplo:
   * {
   *   usedPercent: 42.5,
   *   estimatedAdditionalRecords: 500000,
   *   state: 'NORMAL'
   * }
   */
  const [capacity, setCapacity] = useState(null);

  // Guarda uma possível mensagem de erro.
  const [error, setError] = useState('');

  /*
   * Carrega os principais dados da tela.
   *
   * Essa função faz três requisições:
   *
   * 1. Busca as transações da página atual.
   * 2. Busca as agregações.
   * 3. Busca a capacidade do banco.
   */
  const load = () => {
    /*
     * Recupera o cursor correspondente à página atual.
     *
     * Na primeira página, cursors[0] será null.
     */
    const currentCursor = cursors[cursorIndex];

    /*
     * Monta o endereço das transações.
     *
     * Sempre pede no máximo 30 registros.
     *
     * Se existir um cursor, adiciona:
     * &cursor=valor-do-cursor
     */
    const transactionsPath =
      `/transactions?size=30` +
      (currentCursor ? `&cursor=${currentCursor}` : '');

    // Busca as transações da página atual.
    api(transactionsPath)
      .then((data) => {
        // Coloca as transações recebidas na tabela.
        setRows(data.items);

        // Guarda o cursor necessário para buscar a próxima página.
        setNextCursor(data.nextCursor);
      })
      .catch(setError);

    // Busca os valores agrupados por mês e categoria.
    api('/aggregates')
      .then((data) => {
        setAgg(data);
      })
      .catch(setError);

    // Busca as informações sobre a capacidade do banco.
    api('/capacity')
      .then((data) => {
        setCapacity(data);
      })
      .catch(setError);
  };

  /*
   * Executa load() quando:
   *
   * 1. O componente aparece pela primeira vez.
   * 2. cursorIndex muda.
   *
   * Portanto, ao mudar de página, os dados são carregados novamente.
   */
  useEffect(load, [cursorIndex]);

  /*
   * Monitora o processamento de uma importação.
   *
   * Esse efeito é executado sempre que "job" muda.
   */
  useEffect(() => {
    // Se não existe uma importação, não faz nada.
    if (!job) {
      return;
    }

    /*
     * Se o processamento terminou:
     *
     * 1. Atualiza transações.
     * 2. Atualiza agregações.
     * 3. Atualiza capacidade.
     */
    if (job.status === 'COMPLETED') {
      load();
      return;
    }

    /*
     * Só continua consultando a API enquanto o job estiver
     * em um destes estados:
     *
     * QUEUED: aguardando processamento.
     * PUBLISHING: publicando registros no Kafka.
     * CONSUMING: consumindo e persistindo os registros.
     */
    const processingStatuses = [
      'QUEUED',
      'PUBLISHING',
      'CONSUMING',
    ];

    // Se o status não representar processamento, interrompe o efeito.
    if (!processingStatuses.includes(job.status)) {
      return;
    }

    /*
     * Espera 1 segundo antes de consultar novamente o status.
     *
     * Essa técnica é chamada de polling:
     * o frontend consulta a API repetidamente para acompanhar o processo.
     */
    const timer = setTimeout(() => {
      api(`/imports/${job.id}`)
        .then((updatedJob) => {
          /*
           * Atualiza o job.
           *
           * Como "job" mudou, este useEffect será executado novamente
           * e fará outra consulta depois de 1 segundo.
           */
          setJob(updatedJob);
        })
        .catch(setError);
    }, 1000);

    /*
     * Função de limpeza do efeito.
     *
     * Se o componente for removido ou o job mudar antes de 1 segundo,
     * o timeout anterior será cancelado.
     */
    return () => clearTimeout(timer);
  }, [job]);

  /*
   * Executada quando o usuário seleciona um arquivo CSV.
   *
   * "e" representa o evento disparado pelo input.
   */
  async function upload(e) {
    /*
     * Pega o primeiro arquivo selecionado.
     *
     * O operador ?. evita erro caso files não exista.
     */
    const file = e.target.files?.[0];

    // Se nenhum arquivo foi selecionado, encerra a função.
    if (!file) {
      return;
    }

    // Limpa possíveis erros anteriores.
    setError('');

    /*
     * Cria um formulário que pode transportar arquivos.
     *
     * O FormData será enviado como multipart/form-data.
     */
    const form = new FormData();

    // Adiciona o arquivo no campo chamado "file".
    form.append('file', file);

    try {
      /*
       * Envia o arquivo para a API.
       *
       * method: POST significa criação ou envio de dados.
       * body: form contém o arquivo CSV.
       */
      const createdJob = await api('/imports', {
        method: 'POST',
        body: form,
      });

      /*
       * Guarda os dados do processamento no estado.
       *
       * ...createdJob copia tudo o que a API retornou.
       *
       * Depois são adicionados valores iniciais para mostrar
       * imediatamente o acompanhamento da importação.
       */
      setJob({
        ...createdJob,
        status: 'QUEUED',
        read: 0,
        published: 0,
        persisted: 0,
        errors: 0,
      });
    } catch (exception) {
      // Converte o erro para texto e apresenta na tela.
      setError(String(exception));
    }
  }

  /*
   * Percorre as agregações e encontra o maior valor.
   *
   * Esse valor será usado para calcular o tamanho das barras.
   *
   * O número 1 garante que nunca haverá divisão por zero.
   */
  const max = Math.max(
    ...agg.map((item) => Number(item.total)),
    1,
  );

  /*
   * Soma os valores financeiros de todas as agregações.
   *
   * reduce começa com 0 e acumula item.total.
   */
  const currentTotal = agg.reduce(
    (accumulator, item) =>
      accumulator + Number(item.total),
    0,
  );

  /*
   * Soma a quantidade de registros de todas as agregações.
   */
  const total = agg.reduce(
    (accumulator, item) =>
      accumulator + Number(item.count),
    0,
  );

  /*
   * Tudo que estiver dentro do return representa
   * a interface que será mostrada na página.
   */
  return (
    <main>
      {/* Cabeçalho da página. */}
      <header>
        <div>
          <p className="eyebrow">GEOSAPIENS</p>
          <h1>Central de dados</h1>
        </div>

        {/*
         * O label funciona como botão de importação.
         *
         * accept sugere ao navegador que aceite somente CSV.
         * onChange chama upload quando um arquivo é escolhido.
         */}
        <label className="upload">
          Importar CSV

          <input
            type="file"
            accept=".csv,text/csv"
            onChange={upload}
          />
        </label>
      </header>

      {/*
       * Renderização condicional.
       *
       * Se error possuir algum texto, mostra o parágrafo.
       * Se estiver vazio, não mostra nada.
       */}
      {error && (
        <p className="error">
          {error}
        </p>
      )}

      {/*
       * Mostra o andamento da importação apenas quando existe um job.
       */}
      {job && (
        <section
          className={`job ${job.status.toLowerCase()}`}
        >
          {/* Exibe o status atual em destaque. */}
          <strong>{job.status}</strong>

          {' - '}

          {/* Quantidade de linhas lidas do CSV. */}
          {job.read.toLocaleString()} lidas,

          {' '}

          {/* Quantidade de registros publicados no Kafka. */}
          {job.published.toLocaleString()} no Kafka,

          {' '}

          {/* Quantidade salva no banco de dados. */}
          {job.persisted.toLocaleString()} persistidas,

          {' '}

          {/* Quantidade de registros inválidos. */}
          {job.errors} inválidas

          {/*
           * Se job.message existir, mostra a mensagem entre parênteses.
           */}
          {job.message && ` (${job.message})`}
        </section>
      )}

      {/* Área dos indicadores gerais. */}
      <section className="cards">
        {/* Primeiro indicador: total de registros processados. */}
        <article>
          <span>Total processado</span>
          <b>{total.toLocaleString()}</b>
        </article>

        {/* Segundo indicador: soma dos valores financeiros. */}
        <article>
          <span>Valor agregado</span>
          <b>{money.format(currentTotal)}</b>
        </article>

        {/* Quantidade de combinações entre mês e categoria. */}
        <article>
          <span>Grupos mês/categoria</span>
          <b>{agg.length}</b>
        </article>

        {/*
         * Indicador de uso do banco.
         *
         * capacity?.state significa:
         * acesse state somente se capacity existir.
         *
         * toLowerCase transforma, por exemplo:
         * "WARNING" em "warning".
         *
         * Isso permite aplicar uma classe CSS diferente para cada estado.
         */}
        <article className={capacity?.state?.toLowerCase()}>
          <span>Uso estimado do banco</span>

          <b>
            {capacity
              ? `${capacity.usedPercent.toFixed(2)}%`
              : '...'}
          </b>

          <small>
            {capacity?.state || 'Carregando'}
          </small>
        </article>

        {/* Estimativa de quantos registros ainda cabem no banco. */}
        <article>
          <span>Registros estimados restantes</span>

          <b>
            {capacity
              ? Number(
                capacity.estimatedAdditionalRecords,
              ).toLocaleString()
              : '...'}
          </b>

          <small>Limite configurado</small>
        </article>
      </section>

      {/* Painel do gráfico de barras. */}
      <section className="panel">
        <h2>Agregação por mês e categoria</h2>

        <div className="bars">
          {/*
           * slice(0, 8) pega somente os primeiros oito grupos.
           *
           * map transforma cada item em uma barra visual.
           */}
          {agg.slice(0, 8).map((item) => (
            <div
              className="bar"
              /*
               * key ajuda o React a identificar cada barra.
               *
               * A chave é formada pelo mês e pela categoria.
               */
              key={`${item.month}-${item.category}`}
            >
              <label>
                {item.month} · {item.category}

                <small>
                  {money.format(item.total)}
                  {' '}
                  ({item.count})
                </small>
              </label>

              {/*
               * Calcula a largura da barra em porcentagem.
               *
               * Exemplo:
               * valor atual = 500
               * maior valor = 1000
               *
               * 500 / 1000 × 100 = 50%
               */}
              <i
                style={{
                  width:
                    `${Number(item.total) / max * 100}%`,
                }}
              />
            </div>
          ))}

          {/*
           * Se agg estiver vazio, mostra uma orientação ao usuário.
           *
           * !agg.length será true quando o tamanho for zero.
           */}
          {!agg.length && (
            <p>
              Importe um CSV para visualizar os indicadores.
            </p>
          )}
        </div>
      </section>

      {/* Painel que apresenta as transações. */}
      <section className="panel">
        <div className="title">
          <h2>Transações</h2>

          {/* Mostra a quantidade total de registros agregados. */}
          <span>
            {total.toLocaleString()} registros
          </span>
        </div>

        <div className="table">
          <table>
            {/* Cabeçalho da tabela. */}
            <thead>
              <tr>
                <th>Data</th>
                <th>Categoria</th>
                <th>Valor</th>
                <th>Origem</th>
              </tr>
            </thead>

            {/* Corpo da tabela. */}
            <tbody>
              {/*
               * Percorre as transações da página atual.
               *
               * Cada transação é transformada em uma linha.
               */}
              {rows.map((transaction) => (
                <tr key={transaction.id}>
                  <td>
                    {/*
                     * Converte a data recebida para o formato brasileiro.
                     */}
                    {new Date(
                      transaction.occurred_at,
                    ).toLocaleString('pt-BR')}
                  </td>

                  <td>{transaction.category}</td>

                  <td>
                    {money.format(transaction.amount)}
                  </td>

                  <td>{transaction.source}</td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Mensagem apresentada quando não existem transações. */}
          {!rows.length && (
            <p>Nenhum registro encontrado.</p>
          )}
        </div>

        {/* Navegação entre as páginas de transações. */}
        <nav>
          <button
            /*
             * cursorIndex igual a 0 representa a primeira página.
             *
             * !0 é true, então o botão fica desabilitado.
             */
            disabled={!cursorIndex}
            onClick={() => {
              // Volta uma posição na paginação.
              setCursorIndex(cursorIndex - 1);
            }}
          >
            Anterior
          </button>

          {/* Soma 1 porque o índice começa em zero. */}
          <span>Lote {cursorIndex + 1}</span>

          <button
            /*
             * Se não existir nextCursor, não existe próxima página
             * e o botão fica desabilitado.
             */
            disabled={!nextCursor}
            onClick={() => {
              /*
               * Cria um novo array contendo os cursores antigos
               * e adiciona o cursor da próxima página.
               */
              setCursors([
                ...cursors,
                nextCursor,
              ]);

              /*
               * Avança o índice.
               *
               * A mudança dispara o primeiro useEffect,
               * que executa load() novamente.
               */
              setCursorIndex(cursorIndex + 1);
            }}
          >
            Próxima
          </button>
        </nav>
      </section>
    </main>
  );
}

/*
 * Procura no index.html o elemento:
 *
 * <div id="root"></div>
 *
 * Depois cria a raiz do React dentro dele.
 */
const root = createRoot(
  document.getElementById('root'),
);

/*
 * Renderiza o componente App dentro do elemento root.
 *
 * <App /> é a forma JSX de executar o componente App.
 */
root.render(<App />);