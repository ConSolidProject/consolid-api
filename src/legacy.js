import { QueryEngineComunicaSolid } from "graphql-ld-comunica-solid";
import {
  Session,
  handleIncomingRedirect,
  getDefaultSession,
} from "@inrupt/solid-client-authn-browser";
import { v4 } from "uuid";
import { aclTemplate } from "./templates";
import mime from "mime-types";
const newEngine = require('@comunica/actor-init-sparql').newEngine

async function getProject(projectPodUrl) {
  try {
    const [projectId, stakeholders] = await Promise.all([
      getProjectId(projectPodUrl),
      getStakeholders(projectPodUrl),
    ]);
    for (const st of stakeholders) {
      const contribution = await getStakeholderMetadata(st, projectId);
    }
  } catch (error) {
    console.log(`error`, error);
  }
}

async function getMyProjects(session) {
  console.log('getting projects')
  if (session.info.isLoggedIn && session.info.webId) {
    const lbdLocation = await findLBDlocation(session.info.webId);
    const myProjectIds = await getContainerContent(lbdLocation, session);
    const projectPromises = myProjectIds.map((container) => {
      return getProjectPod(container);
    });
    const myProjects = await Promise.all(projectPromises);
    return myProjects;
  } else {
    throw new Error("No WebID associated with this session");
  }
}

async function getProjectPod(localProjectUri) {
  const myEngine = new QueryEngineComunicaSolid();
  const source = `${localProjectUri}props.ttl`
  const q = `prefix lbd: <https://lbdserver.org/vocabulary#> select ?p where {<${localProjectUri}> lbd:isPartOfProject ?p .}`;
  const result = await myEngine.query(q, {
    sources: [source],
  });
//  myEngine.invalidateHttpCache()
  return {global: result.results.bindings[0].p.value, local: localProjectUri};
}

async function query(sources, query) {
  const myEngine = new QueryEngineComunicaSolid();
  const result = await myEngine.query(query, {
    sources,
  });
//  myEngine.invalidateHttpCache()
  return result.results.bindings;
}

async function getContainerContent(container, session) {
  const myEngine = new QueryEngineComunicaSolid();
  const q = `prefix ldp: <http://www.w3.org/ns/ldp#> select ?res where {<${container}> ldp:contains ?res .}`;

  const result = await myEngine.query(q, { sources: [container] });
//  myEngine.invalidateHttpCache()

  return result.results.bindings.map((item) => item.res.value);
}

async function getStakeholders(projectPodUrl) {
  const myEngine = new QueryEngineComunicaSolid();
  const q = `prefix lbd: <https://lbdserver.org/vocabulary#> select ?st where {<${projectPodUrl}> lbd:hasStakeholderGraph ?st}`;
  const result = await myEngine.query(q, { sources: [projectPodUrl] });
  let stakeholderGraph;
  if (result.results.bindings.length > 0) {
    stakeholderGraph = result.results.bindings[0].st.value;
  } else {
    throw new Error(
      `Did not find stakeholder graph reference at project Pod ${projectPodUrl}`
    );
  }
  const stq = `prefix lbd: <https://lbdserver.org/vocabulary#> select ?st where {<${projectPodUrl}> lbd:hasStakeholder ?st}`;
  const stakeholderResult = await myEngine.query(stq, {
    sources: [stakeholderGraph],
  });
//  myEngine.invalidateHttpCache()

  return stakeholderResult.results.bindings.map((item) => item.st.value);
}

async function getProjectId(projectPodUrl) {
  const myEngine = new QueryEngineComunicaSolid();
  const q = `prefix lbd: <https://lbdserver.org/vocabulary#> select ?id where {<${projectPodUrl}> lbd:hasProjectId ?id}`;
  const result = await myEngine.query(q, { sources: [projectPodUrl] });
//  myEngine.invalidateHttpCache()

  if (result.results.bindings.length > 0) {
    return result.results.bindings[0].id.value;
  } else {
    throw new Error(`Did not find project ID at project Pod ${projectPodUrl}`);
  }
}

async function getStakeholderMetadata(stakeholder, projectId) {
  try {
    const myEngine = new QueryEngineComunicaSolid();

    const lbdLocation = await findLBDlocation(stakeholder);
    const projectRepository = await findProjectRepository(
      lbdLocation,
      projectId
    );
    const resources = await findResourcesInRepository(projectRepository, myEngine);
    const data = {};
    data[stakeholder] = resources;
  //  myEngine.invalidateHttpCache()

    return data;
  } catch (error) {
    console.log(`error`, error);
    throw error;
  }
}

async function findResourcesInRepository(repository) {
  const myEngine = new QueryEngineComunicaSolid()
  const q = `prefix ldp: <http://www.w3.org/ns/ldp#> select ?res where {?c a ldp:Container; ldp:contains ?res .}`;

  const result = await myEngine.query(q, { sources: [repository] });
//  myEngine.invalidateHttpCache()

  // return only those files ending with meta, as these are the main references included in the project (even if the "resource" itself resides somewhere else (e.g. on a third party website))
  return result.results.bindings
    .map((item) => item.res.value)
    .filter((item) => {
      if (item.endsWith("props.ttl")) {
        return item;
      }
    });
}

async function findProjectRepository(lbdLoc, projectId) {
  try {
    const projectRepository = `${lbdLoc}${projectId}/`;
    const exists = await fetch(projectRepository, { method: "HEAD" });
    if (exists.ok) {
      return projectRepository;
    } else {
      throw new Error(
        `Found LBD project location but did not find project with ID ${projectId}`
      );
    }
  } catch (error) {
    throw error;
  }
}

async function findLBDlocation(stakeholder) {
  const myEngine = new QueryEngineComunicaSolid();
  const q = `prefix lbd: <https://lbdserver.org/vocabulary#> select ?index where {<${stakeholder}> lbd:hasProjectRegistry ?index}`;
  const result = await myEngine.query(q, { sources: [stakeholder] });
//  myEngine.invalidateHttpCache()

  if (result.results.bindings.length > 0) {
    return result.results.bindings[0].index.value;
  } else {
    throw new Error(
      `Did not find LBD project location from webID ${stakeholder}`
    );
  }
}

async function joinProject(url, session) {
  const webId = session.info.webId
  const lbdLocation = await findLBDlocation(webId)
  const projectId = await getProjectId(url)
  const projectRepository = lbdLocation + projectId + '/'
  await createContainer(projectRepository, session)


  // update webId
  const query = `
      PREFIX lbd: <https://lbdserver.org/vocabulary#>
      PREFIX dct:  <http://purl.org/dc/terms/>
      PREFIX dcat: <http://www.w3.org/ns/dcat#>

      INSERT DATA {
      <${projectRepository}> a lbd:PartialProject, dcat:Catalog ;
        lbd:hasProjectId "${projectId}" ;
        lbd:isPartOfProject <${url}> .
      }`;
      await update(query, projectRepository + "props.ttl", session);

  const aclUrl = projectRepository + '.acl'
      const aclData = aclTemplate(session)

  await uploadResource(aclUrl, aclData, {mimeType: "text/turtle"}, session)
}

async function createInbox(session, inbox) {
  const webId = session.info.webId;

  // create inbox folder
  if (!inbox) {
    inbox =  webId.split("profile/card#me")[0] + "inbox/";
  }

  const exists = await checkExistence(inbox, session)

  if (!exists) {
    await createContainer(inbox, session)

    // update webId
    const query = `
    PREFIX lbd: <https://lbdserver.org/vocabulary#>
    PREFIX dct:  <http://purl.org/dc/terms/> 
    INSERT DATA {
    
    <> ldp:inbox <${inbox}>.
    }`;
      await update(query, webId, session);
  }

}

async function notifyMetadataOwnerOfNewLinkElementList(newlist, source, metadata, session) {
  for (const li of newlist) {
    const q = `PREFIX lbd: <https://lbdserver.org/vocabulary#> INSERT DATA {<${source}> lbd:hasLinkElementRegistry <${li}>}`
    await update(q, metadata, session)
  }
}

async function makeThisAProjectPod(session, data) {
  try {
    const webId = session.info.webId;
    const projectId = v4();

    // 1 create basic content
    const query = `
PREFIX lbd: <https://lbdserver.org/vocabulary#>
PREFIX dct:  <http://purl.org/dc/terms/> 
INSERT DATA {

  <${webId}> a lbd:Project ;
    lbd:hasProjectId "${projectId}" ;
    dct:title "${data.title}" ;
    dct:description "${data.description}" .
}`;
    await update(query, webId, session);

    // 2 create stakeholdernetwork graph
    const dataContainer = webId.split("profile/card#me")[0] + "data/";

    const dataExists = await checkExistence(dataContainer, session);
    if (!dataExists) {
      await createContainer(dataContainer, session);
      await uploadResource(dataContainer + ".acl", aclTemplate(session), {mimeType: "text/turtle"}, session)
    }

    // 3 create stakeholdergraph in container
    const stakeholderGraph = dataContainer + "stakeholders.ttl";
    await createResource(stakeholderGraph, {mimeType: "text/turtle"}, session);

    // insert data in stakeholdergraph
    for (const st of data.stakeholders) {
      console.log(`st`, st)
      const query = `
      PREFIX lbd: <https://lbdserver.org/vocabulary#>
      INSERT DATA {

        <${webId}> lbd:hasStakeholder <${st}>.
      }`;
      await update(query, stakeholderGraph, session);
      console.log("stakeholder added")
      await inviteStakeholder(st, session);
    }

    // add stakeholdergraph to webId reference
        const stQuery = `
    PREFIX lbd: <https://lbdserver.org/vocabulary#>
    PREFIX dct:  <http://purl.org/dc/terms/>
    INSERT DATA {
      <${webId}> lbd:hasStakeholderGraph <${stakeholderGraph}> .
    }`;
    await update(stQuery, webId, session);
  } catch (error) {
    console.log(`error`, error);
    throw error;
  }
}

async function createResource(url, options, session) {
  await uploadResource(url, "", options, session);
}

async function findInbox(webId) {
  const res = await query(
    [webId],
    `prefix ldp: <http://www.w3.org/ns/ldp#> select * where {<${webId}> ldp:inbox ?inbox .}`
  );
  let inbox = res[0].inbox.value;
  if (!inbox.endsWith("/")) {
    inbox = inbox + "/";
  }

  return inbox
}

async function inviteStakeholder(st, session) {
  const webId = session.info.webId
  // find stakeholder inbox
  const inbox = await findInbox(st)
  const notificationId = v4();
  const notificationUrl = inbox + notificationId + ".ttl";

  // send notification about project invitation
  const message = `
  @prefix foaf: <http://xmlns.com/foaf/0.1/>.
  @prefix solid: <http://www.w3.org/ns/solid/terms#>.
  @prefix lbd: <https://lbdserver.org/vocabulary#>.
  @prefix ldp: <http://www.w3.org/ns/ldp#> .
  @prefix as: <https://www.w3.org/ns/activitystreams#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .

<>
  a as:Announce ;
  as:actor <${webId}> ;
  as:object <#invite> ;
  as:target <${st}> ;
  as:updated "${new Date().toISOString()}"^^xsd:dateTime .

<#invite> a lbd:projectInvitation .
  `;
  await uploadResource(notificationUrl, message, {}, session);
}

async function checkInvites(session) {
  // find inbox
  const inbox = await findInbox(session.info.webId)
  const inboxContent = await getContainerContent(inbox, session)
  const myProjects = await getMyProjects(session)

  const res = await query(inboxContent, `
  prefix lbd: <https://lbdserver.org/vocabulary#> 
  prefix as: <https://www.w3.org/ns/activitystreams#> 
  SELECT ?sender WHERE {?invite a lbd:projectInvitation. ?this as:actor ?sender; as:object ?invite .}`)
  console.log(`res`, res)
  
  const projectInvites = res.map((i) => {
      return i["sender"].value
  })

  
  return projectInvites.filter((pr) => !myProjects.includes(pr))
}

async function uploadResource(url, data, options, session) {
  try {
    if (!options.overwrite) {
      // check if graph does not exist yet
      const exists = await checkExistence(url, session);
      if (exists) {
        throw new Error("Resource already exists");
      }
    }
    //content-type is guessed by uri (default: text/plain)
    let mimeType;
    if (!options.mimeType) {
      mimeType = mime.lookup(url);
      if (mimeType === false) {
        // set default mimetype
        mimeType = "text/plain";
      }
    } else {
      mimeType = options.mimeType;
    }
    var requestOptions = {
      method: "PUT",
      headers: {
        "Content-Type": mimeType,
      },
      body: data,
      redirect: "follow",
    };

    let res;
    res = await session.fetch(url, requestOptions);
    if (res.status !== 205) {
      res = await fetch(url, requestOptions);
    }
    return;
  } catch (error) {
    console.log(`error`, error);
    error.message = `Unable to upload resource - ${error.message}`;
    throw error;
  }
}

async function checkExistence(url, session) {
  try {
    const requestOptions = {
      method: "HEAD",
    };
    const response = await session.fetch(url, requestOptions);
    if (response.status === 200) {
      return true;
    } else {
      return false;
    }
  } catch (error) {
    error.message = `Could not check existence of graph ${url} - ${error.message}`;
    throw error;
  }
}

async function createContainer(url, session) {
  try {
    if (!url.endsWith("/")) {
      url = url.concat("/");
    }
    const requestOptions = {
      method: "PUT",
      headers: {
        "Content-Type": "text/turtle",
      },
      redirect: "follow",
    };
    await session.fetch(url, requestOptions);
    return;
  } catch (error) {
    error.message = `Unable to create container - ${error.message}`;
    throw error;
  }
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

    // console.log(`session.clientAuthentication.fetch`, session.clientAuthentication.fetch)
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

async function findArtefactRegistry(resource) {
  const myEngine = new QueryEngineComunicaSolid()
  const query = `PREFIX lbd: <https://lbdserver.org/vocabulary#> SELECT ?art WHERE {?distribution lbd:hasArtefactRegistry ?art .}`
  const artRegQ = await myEngine.query(query, {sources: [resource.meta]})
  const registry = artRegQ.results.bindings[0].art.value
//  myEngine.invalidateHttpCache()

  return registry
}

async function notifyGlobalRegistry(element, references, globalRegistry, session) {
  for (const reference of references) {
    const q = `
    PREFIX dct: <http://purl.org/dc/terms/>
      INSERT DATA {
        <${element.global}> dct:isReferencedBy <${reference}> .
      }
    `
    console.log(`element, references, globalRegistry`, element, references, globalRegistry)
    await update(q, globalRegistry, session)
  }

  return
}

async function getGlobalArtefact(element, elementSource) {
  const myEngine = newEngine()

  let localLinkElementQuery
  if (!element.startsWith('http')) {
    localLinkElementQuery = `
    PREFIX lbd: <https://lbdserver.org/vocabulary#>
    SELECT ?glob
    WHERE {
      ?glob lbd:hasLinkElement ?le .
      ?le lbd:hasDocument <${elementSource.resource}> ;
        lbd:hasIdentifier ?identifier .
      ?identifier lbd:identifier "${element}" .
    }`
  } else {
    localLinkElementQuery = `
    PREFIX lbd: <https://lbdserver.org/vocabulary#>
    SELECT ?glob
    WHERE {
      ?glob lbd:hasLinkElement ?le .
      ?le lbd:hasDocument <${elementSource.resource}> ;
        lbd:hasIdentifier ?identifier .
      ?identifier lbd:identifier <${element}> .
    }`
  }

  const globRes = await myEngine.query(localLinkElementQuery, {sources: elementSource.linkElements})
  const globBinding = await globRes.bindings()
  globBinding.forEach((b) => console.log(b.get('?glob').id))
//  myEngine.invalidateHttpCache()

  return globBinding
}

async function getAliases(element, elementSource, activeResources, options, session) {
  const globBinding = await getGlobalArtefact(element, elementSource)
  const responses = []
  for (let art of globBinding) {
    art = art.get('?glob').id
    let lePromises
    if (options.project && options.artefactRegistry) {
      const occurences = await getOccurencesInArtefactRegistry(art, options.artefactRegistry)
      lePromises = occurences.map((occ) => getLinkElement(art, occ))
    } else {
       lePromises = activeResources.map((item) => item.linkElements).flat().map((le) => getLinkElement(art, le))
    }
    responses.push(lePromises)
  }
  const res = await Promise.all(responses.flat())
  console.log(`res`, res)
  return res
}

async function getOccurencesInArtefactRegistry(glob, artefactRegistry) {
  try {
    const myEngine = newEngine()
    const q = `
    PREFIX dct: <http://purl.org/dc/terms/>
    SELECT ?occ
    WHERE {
      <${glob}> dct:isReferencedBy ?occ .
    }`
    const res = await myEngine.query(q, {sources: [artefactRegistry]})
    const resBindings = await res.bindings()
    const occurences = resBindings.map(item => {return item.get("?occ").id})
  //  myEngine.invalidateHttpCache()

    return occurences
  } catch (error) {
    console.log(`error`, error)
    throw error
  }

}

async function getLinkElement(glob, le) {
  const myEngine = newEngine()
  const q = `
  PREFIX lbd: <https://lbdserver.org/vocabulary#>
  SELECT ?doc ?id
  WHERE {
    <${glob}> lbd:hasLinkElement ?le .
    ?le lbd:hasDocument ?doc ;
      lbd:hasIdentifier ?identifier .
    ?identifier lbd:identifier ?id .
  }`
  const res = await myEngine.query(q, {sources: [le]})
  const resBindings = await res.bindings()
  const response = resBindings.map((b) => {
    const document = b.get("?doc").id
    const id = b.get("?id").id
    return {document, id}
  })
//  myEngine.invalidateHttpCache()

  return response
}

export {
  getProject,
  getMyProjects,
  getStakeholders,
  getProjectId,
  findLBDlocation,
  findProjectRepository,
  findResourcesInRepository,
  makeThisAProjectPod,
  checkInvites,
  joinProject,
  update,
  checkExistence,
  uploadResource,
  findArtefactRegistry,
  createResource,
  notifyGlobalRegistry,
  notifyMetadataOwnerOfNewLinkElementList,
  getAliases,
  getGlobalArtefact,
  getLinkElement
};
