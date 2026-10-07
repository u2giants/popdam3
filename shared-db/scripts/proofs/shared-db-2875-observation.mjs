// Same-issue #2875 catalog observation; backend owns acceptance and generated types.
// Retire this adapter after its required acceptance evidence is archived.
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import expected from './2875-contract.json' with {type:'json'};
import {createCatalogObserver} from './shared-db-catalog-observation.mjs';
export const {validateCatalog,validateEnvironment,queryCatalog,buildObservation,main,WORKFLOW}=createCatalogObserver({
 expected,issue:2875,workflow:'.github/workflows/shared-db-2875-observation.yml',baseUrl:import.meta.url,
 sqlName:'./2875-catalog.sql',contractName:'./2875-contract.json'});
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main();
