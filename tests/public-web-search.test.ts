import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPublicKnowledge } from '../src/knowledge/public-web-search';

test('public search returns linked evidence and strips snippet markup', async () => {
  const result = await searchPublicKnowledge('cells in biology', async (url) => {
    assert.match(String(url), /srsearch=cells\+in\+biology/);
    return new Response(JSON.stringify({ query: { search: [{ title: 'Cell (biology)', snippet: 'A <span class="searchmatch">cell</span> is a unit.' }] } }), { status: 200 });
  });
  assert.equal(result.results[0].source, 'Wikipedia');
  assert.equal(result.results[0].snippet, 'A cell is a unit.');
  assert.match(result.results[0].url, /^https:\/\/en\.wikipedia\.org\/wiki\//);
});

test('public search rejects empty or oversized topics', async () => {
  await assert.rejects(searchPublicKnowledge(''), /topic/);
  await assert.rejects(searchPublicKnowledge('x'.repeat(121)), /120/);
});
