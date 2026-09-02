/** Network binding: exposure verdict, bind address mode, custom host. */
import { Setting } from 'obsidian';
import { classifyFromSettings } from '../../utils/network-classifier';
import type { SettingsUIHost } from '../host-types';
import { resetRenderRow, Group } from '../ui-helpers';

export function networkBindingGroup(host: SettingsUIHost): Group {
  return {
    type: 'group'
    , heading: 'Network binding'
    , items: [
      {
        name: 'Network exposure display'
        , searchable: false
        , render: (setting: Setting) => {
          const s = host.settings;
          const verdict = classifyFromSettings({
            httpsEnabled: s.httpsEnabled
            , bindMode: s.bindMode
            , customBindHost: s.customBindHost
            , userSuppliedCert: !!(s.certificateConfig?.certPath && s.certificateConfig?.keyPath)
          });
          const container = resetRenderRow(setting);
          const badgeEmoji = verdict.class === 'ok' ? '🟢' : verdict.class === 'warn' ? '🟡' : '🔴';
          const badgeLabel = verdict.class === 'ok' ? 'OK' : verdict.class === 'warn' ? 'WARN' : 'INSECURE';
          const badgeEl = container.createDiv({ cls: `mcp-network-badge mcp-network-badge-${verdict.class}` });
          badgeEl.createEl('strong', { text: `${badgeEmoji} ${badgeLabel} — ` });
          badgeEl.createSpan({ text: verdict.reason });
          if (verdict.class === 'jail') {
            badgeEl.createEl('br');
            badgeEl.createSpan({
              text: 'Reconfigure: switch the bind address below to Loopback, or enable HTTPS.'
              , cls: 'mcp-network-badge-hint'
            });
          }
          if (s.bindMode === 'all') {
            const caution = container.createDiv({ cls: 'mcp-network-caution' });
            caution.createEl('strong', { text: '⚠ All interfaces selected. ' });
            caution.createSpan({
              text: s.httpsEnabled
                ? 'Encrypted via HTTPS — clients must trust the certificate. Use a real (non-self-signed) cert for public networks.'
                : 'API key and document text will be sent in cleartext over the network. Enable HTTPS or switch to loopback.'
            });
          }
          if (s.bindMode === 'custom' && s.customBindHost.trim() === '') {
            const empty = container.createDiv({ cls: 'mcp-network-caution' });
            empty.createSpan({ text: 'No custom address entered yet — server will fall back to loopback (127.0.0.1) until you enter one.' });
          }
        }
      }
      , {
        name: 'Bind address'
        , desc: 'Which network interface the MCP server listens on. Loopback only is recommended.'
        , aliases: ['bind', 'loopback', 'interface', 'host']
        , control: {
          type: 'dropdown'
          , key: 'bindMode'
          , options: {
            'loopback': 'Loopback only — local machine'
            , 'all': 'All interfaces — anyone on the network can attempt to connect'
            , 'custom': 'Custom address…'
          }
        }
      }
      , {
        name: 'Custom bind address'
        , desc: 'IPv4/IPv6/hostname to bind to. Typing only stores the value; the Apply row below normalizes it and restarts the server.'
        , aliases: ['bind', 'host', 'ip']
        , visible: () => host.settings.bindMode === 'custom'
        , control: { type: 'text', key: 'customBindHost', placeholder: 'e.g. 192.168.1.50' }
      }
      , {
        name: 'Apply custom bind address'
        , desc: 'Normalize and apply the address. A loopback address switches the mode to loopback; a wildcard switches to all interfaces.'
        , visible: () => host.settings.bindMode === 'custom'
        , action: () => { void host.applyCustomBindHost(); }
      }
    ]
  };
}
