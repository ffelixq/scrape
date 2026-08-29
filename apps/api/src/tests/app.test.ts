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

  it('rejects vague research questions', async () => {
    const response = await request(app)
      .post('/api/investigations')
      .send({ question: 'why?' })
      .expect(400);
    expect(response.body.error).toBe('Invalid request');
  });
});
