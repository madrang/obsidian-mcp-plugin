/**
 * Side-effect imports: each module registers its tool into the registry.
 * The import order fixes the enumeration order of the tools/list response.
 */
import '../files/definitions';
import '../edit/definitions';
import '../view/definitions';
import './system';
import './graph';
import '../bases/definitions';
import './dataview';
