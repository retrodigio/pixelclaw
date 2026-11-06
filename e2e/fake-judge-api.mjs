// A preload for the CLI in tests (node --import): the judge's HTTP call is answered here, in the
// API's documented shapes, instead of reaching the network. The recognisable question is picked
// as the sprite itself, "reads" is unsure, "stray" is a clear yes (a failure) with a box.
const real = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://api.typesafe.ai/')) return real(url, init);
  const body = JSON.parse(init.body);
  const answers = {};
  for (const [id, q] of Object.entries(body.questions)) {
    if (q.type === 'box') answers[id] = { type: 'box', box: { top: 0.25, bottom: 0.5, left: 0.5, right: 0.75 }, confidence: null };
    else if (q.type === 'choice') {
      const self = body.state.asset.name;
      answers[id] = { type: 'choice', choice: self, confidence: 0.8, probabilities: Object.fromEntries(Object.keys(q.criteria).map((k) => [k, k === self ? 0.9 : 0.1 / (Object.keys(q.criteria).length - 1)])) };
    } else answers[id] = { type: 'noul', noul: id.startsWith('reads') ? 0.5 : id === 'stray' ? 0.92 : 0.9 };
  }
  return new Response(JSON.stringify({ model: body.model, answers, usage: { input_tokens: 1234, output_tokens: 20 } }));
};
