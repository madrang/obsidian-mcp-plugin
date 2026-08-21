/**
 * The scope-folder autocomplete walk. The model: root folders on an empty
 * field, then for a typed value the parents up to the root plus the children
 * of the current value; a partial last segment filters to the siblings that
 * continue it. Only real folders are ever proposed.
 */
import { folderScopeSuggestions } from '../src/settings/folder-suggest';

const FOLDERS = [
  'Archive',
  'Obsidian',
  'Obsidian/Language',
  'Projects',
  'Projects/Blog',
  'Projects/Blog/Drafts',
  'Projects/Research',
];

describe('folderScopeSuggestions', () => {
  test('empty value offers the root-level folders, sorted', () => {
    expect(folderScopeSuggestions('', FOLDERS)).toEqual(['Archive', 'Obsidian', 'Projects']);
  });

  test('a top-level folder offers its children, no redundant ancestors', () => {
    expect(folderScopeSuggestions('Projects', FOLDERS)).toEqual([
      'Projects/Blog',
      'Projects/Research',
    ]);
  });

  test('a nested folder offers its parent chain plus its children', () => {
    expect(folderScopeSuggestions('Projects/Blog', FOLDERS)).toEqual([
      'Projects',
      'Projects/Blog/Drafts',
    ]);
  });

  test('a leaf folder offers only its parent chain', () => {
    expect(folderScopeSuggestions('Projects/Blog/Drafts', FOLDERS)).toEqual([
      'Projects',
      'Projects/Blog',
    ]);
  });

  test('a partial top-level segment filters the root folders', () => {
    expect(folderScopeSuggestions('Pro', FOLDERS)).toEqual(['Projects']);
  });

  test('a partial nested segment offers the real parents plus matching children', () => {
    expect(folderScopeSuggestions('Projects/Bl', FOLDERS)).toEqual([
      'Projects',
      'Projects/Blog',
    ]);
    expect(folderScopeSuggestions('Projects/Blog/Dr', FOLDERS)).toEqual([
      'Projects',
      'Projects/Blog',
      'Projects/Blog/Drafts',
    ]);
  });

  test('a value with no matching folders offers the parents of the deepest real prefix', () => {
    expect(folderScopeSuggestions('Projects/Nothing/Here', FOLDERS)).toEqual(['Projects']);
  });

  test('whitespace and slashes are normalized before the walk', () => {
    expect(folderScopeSuggestions('  /Projects/Blog/  ', FOLDERS)).toEqual([
      'Projects',
      'Projects/Blog/Drafts',
    ]);
  });
});
