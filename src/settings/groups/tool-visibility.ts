/** Tool visibility: one section per tool, a toggle per action. */
import type { SettingGroupItem } from 'obsidian';
import { ALL_OPERATIONS, getActionsForOperation } from '../../tools/tool-factory';
import { getActionDescriptionLines, getStaticDescriptionLines, getOperationDefinition } from '../../tools/tool-registry';
import type { SettingsUIHost } from '../host-types';
import { boxedDesc, Group } from '../ui-helpers';

export function toolVisibilityGroups(host: SettingsUIHost): Group[] {
  const visibilityOps = ALL_OPERATIONS.filter(op => op !== 'dataview' || host.isDataviewAvailable());
  return visibilityOps.flatMap(op => {
    const actions = getActionsForOperation(op).filter(a => !(op === 'system' && a === 'fetch_web'));
    if (actions.length === 0) return [];
    // One section per tool. The heading carries the tool name at section
    // weight, above its actions, and the section ends at the tool's last
    // row — the next tool opens a section of its own. The tool row carries
    // only the tool-level text. Every action-owned description line moves
    // down to its own switch, so no row repeats the whole surface as one
    // wall of text. Fragments keep the line structure (a string desc
    // collapses its newlines), and the framework indexes a fragment's
    // textContent for search.
    const items: SettingGroupItem[] = [];
    // The tool emojis are gone from the descriptions (removed 2026-08-24,
    // see the vault Descriptor Review). The strip keeps only the markdown
    // markers off the intro prose: heading hashes and bullet dashes.
    const toolLines = getStaticDescriptionLines(op).map(line =>
      line.replace(/^(?:#{1,6}|-) /, '')
    );
    while (toolLines[toolLines.length - 1] === '') toolLines.pop();
    items.push({
      name: op
      , desc: boxedDesc(`Show or hide the ${op} tool and all its actions.`, toolLines)
      , aliases: ['tool', 'visibility']
      , control: { type: 'toggle', key: `vis.${op}` }
    });
    const gateKeys: ReadonlySet<string> = new Set(
      host.settings.allowCreateOverwrite === true ? ['gate:overwrite'] : []
    );
    for (const action of actions) {
      const actionLines = getActionDescriptionLines(op, action, gateKeys)
        .map(line => line.replace(/^- `[\w-]+` — /, '').replace(/^\s+/, ''))
        .filter(line => line !== '');
      // The summary line is permanent. The boxed description below it is
      // extra: it appears only when the action owns description lines.
      const intro = `Show or hide the ${action} action of the ${op} tool`;
      items.push({
        name: `${op}.${action}`
        , desc: actionLines.length > 0 ? boxedDesc(intro, actionLines) : intro
        , aliases: ['tool', 'visibility', op, action]
        , control: { type: 'toggle', key: `vis.${op}.${action}` }
      });
    }
    if (op === 'files') {
      items.push({
        name: 'Allow overwrite'
        , desc: 'Let files actions replace existing content (overwrite=true)'
        , aliases: ['files', 'overwrite']
        , control: { type: 'toggle', key: 'allowCreateOverwrite' }
      });
    }
    const title = getOperationDefinition(op)?.title ?? op;
    return [{ type: 'group' as const, heading: `${op} — ${title}`, items }];
  });
}
