import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../app.js';

describe('Proofline API', () => {
  const app = createApp();

  it('reports a healthy demo runtime', async () => {
    const response = await request(app).get('/api/health').expect(200);
    expect(response.body.status).toBe('ok');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });

  it('creates a complete credential-free demonstration investigation', async () => {
    const response = await request(app)
      .post('/api/investigations')
      .send({
        question: 'Is this supplier financially ready for a two-year contract?',
        mode: 'DEEP',
      })
      .expect(201);
    expect(response.body.status).toBe('COMPLETED');
    expect(response.body.verdict).toBe('INCONCLUSIVE');
    expect(response.body.sources.length).toBeGreaterThan(2);
    expect(response.body.securityEvents[0].category).toBe('PROMPT_INJECTION');
  });

  it('keeps completed investigations in history', async () => {
    const created = await request(app)
      .post('/api/investigations')
      .send({ question: 'Is this vendor certification claim verifiable?' })
      .expect(201);

    const history = await request(app).get('/api/investigations').expect(200);
    const entry = history.body.investigations.find(
      (item: { id: string }) => item.id === created.body.id,
    );
    expect(entry).toBeDefined();
    expect(entry.status).toBe('COMPLETED');
    expect(entry.title.length).toBeLessThanOrEqual(65);
    expect(entry.sourcesChecked).toBeGreaterThan(0);
  });

  it('answers a follow-up inside the existing investigation and records both turns', async () => {
    const created = await request(app)
      .post('/api/investigations')
      .send({ question: 'Is this supplier able to meet a two-year commitment?' })
      .expect(201);

    const response = await request(app)
      .post(`/api/investigations/${created.body.id}/messages`)
      .send({ question: 'Which three sources are the most reliable?' })
      .expect(201);

    expect(response.body.id).toBe(created.body.id);
    expect(response.body.messages).toHaveLength(2);
    expect(response.body.messages[0].role).toBe('USER');
    expect(response.body.messages[1].role).toBe('ASSISTANT');
    expect(response.body.messages[1].kind).toBe('FOLLOW_UP');
    expect(response.body.messages[1].content).toMatch(/strongest source/i);
    expect(response.body.messages[1].citedSourceIds.length).toBeGreaterThan(0);
    // The research result itself is untouched by a follow-up.
    expect(response.body.verdict).toBe(created.body.verdict);
    expect(response.body.sources).toHaveLength(created.body.sources.length);

    const reloaded = await request(app).get(`/api/investigations/${created.body.id}`).expect(200);
    expect(reloaded.body.messages).toHaveLength(2);
  });

  it('refuses a follow-up before the investigation has finished', async () => {
    const response = await request(app)
      .post('/api/investigations/00000000-0000-4000-8000-000000000000/messages')
      .send({ question: 'What changed?' })
      .expect(404);
    expect(response.body.error).toBe('Investigation not found');
  });

  it('removes a deleted investigation from history', async () => {
    const created = await request(app)
      .post('/api/investigations')
      .send({ question: 'Is this procurement record still current today?' })
      .expect(201);

    await request(app).delete(`/api/investigations/${created.body.id}`).expect(204);

    const history = await request(app).get('/api/investigations').expect(200);
    expect(
      history.body.investigations.some((item: { id: string }) => item.id === created.body.id),
    ).toBe(false);
  });

  it('rejects vague research questions', async () => {
    const response = await request(app)
      .post('/api/investigations')
      .send({ question: 'why?' })
      .expect(400);
    expect(response.body.error).toBe('Invalid request');
  });
});
