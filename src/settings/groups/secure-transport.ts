/** Secure transport: HTTPS toggle, certificate paths, TLS floor, cert status. */
import { Setting } from 'obsidian';
import type { SettingsUIHost } from '../host-types';
import { resetRenderRow, validatePort, Group } from '../ui-helpers';
import { DEFAULT_SETTINGS } from '../plugin-settings';

export function secureTransportGroup(host: SettingsUIHost): Group {
  const s = host.settings;
  const httpsOn = () => host.settings.httpsEnabled;
  return {
    type: 'group'
    , heading: 'Secure transport'
    , items: [
      {
        name: 'Enable HTTPS server'
        , desc: `Enable HTTPS server on port ${s.httpsPort}` + (s.httpEnabled ? ' (optional when HTTP is enabled)' : ' (required - cannot be disabled when HTTP is disabled)')
        , aliases: ['https', 'tls', 'certificate']
        , control: {
          type: 'toggle'
          , key: 'httpsEnabled'
          , disabled: () => !host.settings.httpEnabled && host.settings.httpsEnabled
        }
      }
      , {
        name: 'Secure port'
        , desc: 'Port for secure connections (default: 3444)'
        , aliases: ['https', 'port']
        , visible: httpsOn
        , control: { type: 'number', key: 'httpsPort', placeholder: String(DEFAULT_SETTINGS.httpsPort), defaultValue: DEFAULT_SETTINGS.httpsPort, validate: validatePort }
      }
      , {
        name: 'Auto-generate certificate'
        , desc: 'Automatically generate a self-signed certificate if none exists'
        , aliases: ['https', 'tls', 'certificate']
        , visible: httpsOn
        , control: { type: 'toggle', key: 'certAutoGenerate' }
      }
      , {
        name: 'Certificate path'
        , desc: 'Path to a custom certificate file (.crt) - leave empty for auto-generated'
        , aliases: ['https', 'tls', 'certificate']
        , visible: httpsOn
        , control: { type: 'text', key: 'certPath', placeholder: 'Leave empty for auto-generated' }
      }
      , {
        name: 'Key path'
        , desc: 'Path to the private key file (.key) - leave empty for auto-generated'
        , aliases: ['https', 'tls', 'certificate', 'key']
        , visible: httpsOn
        , control: { type: 'text', key: 'certKeyPath', placeholder: 'Leave empty for auto-generated' }
      }
      , {
        name: 'Minimum TLS version'
        , desc: 'Minimum TLS version to accept'
        , aliases: ['https', 'tls']
        , visible: httpsOn
        , control: {
          type: 'dropdown'
          , key: 'certMinTLSVersion'
          , options: { 'TLSv1.2': 'TLS 1.2', 'TLSv1.3': 'TLS 1.3' }
        }
      }
      , {
        name: 'Certificate status display'
        , searchable: false
        , visible: httpsOn
        , render: (setting: Setting) => {
          const container = resetRenderRow(setting);
          const statusEl = container.createDiv('mcp-cert-status');
          statusEl.createEl('p', { text: 'Checking certificate…', cls: 'setting-item-description mcp-security-note' });
          void import('../../utils/certificate-manager').then(module => {
            statusEl.empty();
            const certManager = new module.CertificateManager(host.app);
            if (certManager.hasDefaultCertificate()) {
              const paths = certManager.getDefaultPaths();
              const loaded = certManager.loadCertificate(paths.certPath, paths.keyPath);
              if (loaded) {
                const info = certManager.getCertificateInfo(loaded.cert);
                if (info) {
                  statusEl.createEl('p', {
                    text: `✅ Certificate valid until: ${info.validTo.toLocaleDateString()}`
                    , cls: 'setting-item-description mcp-security-note'
                  });
                  if (info.daysUntilExpiry < 30) {
                    statusEl.createEl('p', {
                      text: `⚠️ Certificate expires in ${info.daysUntilExpiry} days`
                      , cls: 'setting-item-description mod-warning'
                    });
                  }
                }
              }
            } else {
              statusEl.createEl('p', {
                text: '📝 No certificate found - will auto-generate on server start'
                , cls: 'setting-item-description mcp-security-note'
              });
            }
          });
        }
      }
    ]
  };
}
