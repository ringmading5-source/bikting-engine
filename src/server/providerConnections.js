const catalog = [
  { id: 'github', name: 'GitHub', auth: 'oauth', capabilities: ['repository.read', 'repository.write'] },
  { id: 'render', name: 'Render', auth: 'api_key', capabilities: ['service.deploy'] },
  { id: 'google-drive', name: 'Google Drive', auth: 'oauth', capabilities: ['file.read', 'file.write'] },
  { id: 'openai', name: 'OpenAI', auth: 'api_key', capabilities: ['model.generate'] },
  { id: 'gemini', name: 'Google Gemini', auth: 'api_key', capabilities: ['knowledge.retrieve', 'model.generate'] },
];
export function createProviderConnections({ env = {} } = {}) {
  const connected = new Set();
  return {
    list() { return catalog.map((provider) => ({ ...provider, status: connected.has(provider.id) ? 'connected' : 'requires_user_auth', configured: Boolean(env[envKey(provider.id)]) })); },
    connect(id) { const provider = catalog.find((item) => item.id === id); if (!provider) return { status: 'not_found', id }; connected.add(id); return { id, status: 'requires_user_auth', provider: provider.name, auth: provider.auth, authUrl: null, message: `Connect ${provider.name} through its account authorization flow before Bikting can use ${provider.capabilities.join(', ')}.` }; },
    disconnect(id) { connected.delete(id); return { id, status: 'disconnected' }; },
  };
}
function envKey(id) { return `${id.replaceAll('-', '_').toUpperCase()}_API_KEY`; }
