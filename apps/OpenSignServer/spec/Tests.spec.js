import axios from 'axios';

/* global describe, it, expect, fail */

describe('OpenSign PostgreSQL server', () => {
  it('serves the hardened application root', async () => {
    const { data, headers, status } = await axios.get('http://localhost:30001/');
    expect(status).toBe(200);
    expect(headers['content-type']).toContain('text/html');
    expect(data).toBe('opensign-server is running !!!');
  });

  it('does not report ready before startup migrations finish', async () => {
    const response = await axios.get('http://localhost:30001/healthz', {
      validateStatus: () => true,
    });
    expect(response.status).toBe(503);
    expect(response.data).toEqual({ status: 'starting' });
  });

  it('protects the private portal bridge', async () => {
    const response = await axios.post(
      'http://localhost:30001/portal/v1/nda',
      {},
      { validateStatus: () => true }
    );
    expect(response.status).toBe(401);
    expect(response.data.code).toBe('PORTAL_UNAUTHORIZED');
  });

  it('blocks arbitrary client-side class creation', async () => {
    const object = new Parse.Object('UnapprovedClientClass');
    try {
      await object.save();
      fail('Client-side class creation should be blocked.');
    } catch (error) {
      expect(error.code).toBe(119);
      expect(error.message).toBe('Permission denied');
    }
  });
});
