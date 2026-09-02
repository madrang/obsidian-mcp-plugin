/** Interface: status bar and debug logging. */
import { Group } from '../ui-helpers';

export function interfaceGroup(): Group {
  return {
    type: 'group'
    , heading: 'Interface'
    , items: [
      {
        name: 'Show connection status'
        , desc: 'Show MCP server status in the status bar'
        , aliases: ['status bar']
        , control: { type: 'toggle', key: 'showConnectionStatus' }
      }
      , {
        name: 'Debug logging'
        , desc: 'Enable detailed debug logging in console'
        , aliases: ['debug', 'logs']
        , control: { type: 'toggle', key: 'debugLogging' }
      }
    ]
  };
}
