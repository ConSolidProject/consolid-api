import { QueryEngineComunicaSolid } from "graphql-ld-comunica-solid";

const N3 = require("n3");
const { DataFactory } = N3;
const { namedNode, literal, defaultGraph, quad } = DataFactory;
const newEngine = require("@comunica/actor-init-sparql").newEngine
const meta = "props.ttl"
const prefixes = `
prefix ldp: <http://www.w3.org/ns/ldp#> 
prefix lbd: <https://lbdserver.org/vocabulary#>
prefix dcat: <http://www.w3.org/ns/dcat#>
prefix owl: <http://www.w3.org/2002/07/owl#>
`

async function executeQuery(query, sources, session) {
  // const store = new N3.Store
  // for (const source of sources) {
  //   const response = await session.fetch(source)
  //   const text = await response.text()
  //   const parser = new N3.Parser();
  //   await parseData(text, store, parser) 
  // }
  const q = prefixes + query
  const myEngine = new QueryEngineComunicaSolid();
  const results = await myEngine.query(q, {sources})
  return results
}

async function extractQueryResults(results, variables) {
  const resultObject = {}
  for (const variable of variables) {
    try {

        resultObject[variable] = results.results.bindings.map(b => b[variable].value).filter(b => b != undefined)
      
      // const bindings = await results.bindings()
      // console.log(`variable`, variable)
      // resultObject[variable] = bindings.map(b => { console.log(b.get("?" + variable).id); return b.get("?" + variable).id})
    } catch (error) {
      console.log(`error`, error)
    }
  }
  return resultObject
}

async function loadProjectMetadata(project, store, session) {
  try {
  // find stakeholders in project
  const projectId = await getProjectId(project, session)
  const stakeholders = await getStakeholdersFromProject(project, session)
  for (const st of stakeholders) {
    const lbdLoc = await getLBDlocation(st, session)
    const projLoc = lbdLoc + projectId + "/"
    // fetch their artefactRegistries and put in local triplestore
    const artLoc = projLoc + "artefactRegistry.ttl"
    // const backendUrl = `http://localhost:5050/${projectId}/artefacts`
    const artRes = await session.fetch(artLoc)
    const artReg = await artRes.text()
    if (artReg) {
    const parser = new N3.Parser();
    await parseData(artReg, store, parser, artLoc + "#")      
    } else {
      console.log(st, "has no artefact registry")
    }

  }
  return    
  } catch (error) {
    console.log(`error`, error)
  }
}

function parseData(data, store, parser, graph) {
  return new Promise((resolve, reject) => {
      if (data) {
        parser.parse(data, (error, q, prefixes) => {
            if (q) {
              let s = q.subject.id
              let p = q.predicate.id
              let o = q.object.id
              if (q.subject.id.startsWith('#')) {
                s = graph + q.subject.id
              }
              if (q.predicate.id.startsWith('#')) {
                p = graph + q.predicate.id
              }
              if (q.object.id.startsWith('#')) {
                o = graph + q.object.id
              }

              const newQ = quad(
                namedNode(s),
                namedNode(p),
                namedNode(o),
                defaultGraph()
              )
              store.addQuad(newQ);
            } else {
              resolve();
            }
          });
      }
  });
}

// get projects from aggregator
async function getProjectsFromAggregator(aggregator, session) {
  let aggr = aggregator
  if (!aggr.endsWith('/')) aggr += '/'
  const query = `
  SELECT ?project WHERE {
    ?s a lbd:Aggregator ;
      lbd:aggregates ?project .
  }`

  const projects = await executeQuery(query, [aggr], session)
  const {project} = await extractQueryResults(projects, ["project"])
  return project
}

// hardcoded assumption that id is last part of project URL
async function getProjectId(project, session) {
  const id = project.split('/')[project.split('/').length -2]
  return id
}

// get stakeholders from project
async function getStakeholdersFromProject(project, session) {
  let proj = project
  if (!proj.endsWith('/')) proj += '/'
  const query = `
  SELECT ?st WHERE {
    <${project}> a lbd:PartialProject ;
      lbd:hasMember ?st .
  }`
  const results = await executeQuery(query, [project], session)
  const {st} = await extractQueryResults(results, ["st"])
  return st
}

// get projectdata from stakeholders
async function getProjectDataFromStakeholder(stakeholder, projectId, session) {
  const LBDlocation = await getLBDlocation(stakeholder, session)
  if (!projectId.endsWith("/")) projectId += '/'
  const projectLocation = LBDlocation + projectId
  const data = await getAuthorisedFilesInRepository(projectLocation, session)
  return {stakeholder, data}
}

async function getAuthorisedFilesInRepository(stakeholderProjectRepository, session) {
  const query = `
    SELECT ?dataset WHERE {
      <${stakeholderProjectRepository}> ldp:contains ?dataset .
    }
  `
  const results = await executeQuery(query, [stakeholderProjectRepository], session)
  const {dataset} = await extractQueryResults(results, ["dataset"])
  const metadata = dataset.filter((el) => el.endsWith(meta))
  const resources = []
  for (const md of metadata) {
    const accessRights = await getAccessRights(md, session)
    const q = `
    SELECT ?uri WHERE {
      ?meta a dcat:Dataset ;
      dcat:distribution ?dist .
      ?dist dcat:downloadURL ?uri .
    }`
    const res2 = await executeQuery(q, [md], session)
    const {uri} = await extractQueryResults(res2, ["uri"])
    resources.push({artefactRegistry: stakeholderProjectRepository + "artefactRegistry.ttl", accessRights, metadata: md, main: uri[0]})
  }
  return resources
}

async function getAccessRights(resource, session) {
  const requestOptions = {
    method: "HEAD",
  };
  const result = await session.fetch(resource, requestOptions)
  let rights = result.headers.get('WAC-Allow').split(',')
  const user = rights[0].replace("user=", "").replaceAll('"', "").split(' ')
  return user
}

async function getLBDlocation(stakeholder, session) {
  const q = `select ?index where {<${stakeholder}> lbd:hasProjectRegistry ?index}`;
  const results = await executeQuery(q, [stakeholder], session);
  let {index} = await extractQueryResults(results, ["index"])
  if (!index[0].endsWith("/")) index += '/'
  return index[0]
}

async function update(query, graph, session) {
  try {
    var myHeaders = new Headers();
    myHeaders.append("Content-Type", "application/sparql-update");

    var requestOptions = {
      method: "PATCH",
      headers: myHeaders,
      body: query,
      redirect: "follow",
    };

    let res;
    res = await session.fetch(graph, requestOptions);
    if (res.status !== 205) {
      console.log(
        "solid fetch not working - using custom fetch as unauthenticated actor"
      );
      res = await fetch(graph, requestOptions);
    }

    return;
  } catch (error) {
    console.log(`error`, error);
    throw error;
  }
}

async function findObjectAliases(globalId, sources, session) {
  const query = `
  SELECT ?alias WHERE {
  <${globalId}> owl:sameAs ?alias .
  }
  `
  const results = await executeQuery(query, sources, session)
  const {alias} = await extractQueryResults(results, ["alias"])
  return alias
}

async function getLocalContexts(aliases, sources, session) {
  
}

export {
  executeQuery,
  getAuthorisedFilesInRepository,
  getStakeholdersFromProject,
  getProjectsFromAggregator,
  getProjectDataFromStakeholder,
  getLBDlocation,
  getAccessRights,
  update,
  findObjectAliases,
  getLocalContexts,
  loadProjectMetadata,
  getProjectId
}