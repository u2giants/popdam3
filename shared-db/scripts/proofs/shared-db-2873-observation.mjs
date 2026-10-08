// Same-issue #2873 catalog observation; Service Identities owns acceptance and generated types.
// Retire this adapter after its required acceptance evidence is archived.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import expected from './2873-contract.json' with {type:'json'};
import {createCatalogObserver} from './shared-db-catalog-observation.mjs';
export const {validateCatalog,validateEnvironment,queryCatalog,buildObservation,main,WORKFLOW}=createCatalogObserver({
 expected,issue:2873,workflow:'.github/workflows/shared-db-2873-observation.yml',baseUrl:import.meta.url,
 sqlName:'./2873-catalog.sql',contractName:'./2873-contract.json'});
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
