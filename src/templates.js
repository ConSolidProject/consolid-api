import { v4 } from "uuid";

const aclTemplate = (session) => {
    return `
    @prefix  acl:  <http://www.w3.org/ns/auth/acl#> .       
      
    <#${v4()}>
        a acl:Authorization;
        acl:accessTo    <./>;
        acl:default     <./> ;
        <http://www.w3.org/ns/auth/acl#agent> <${session.info.webId}>;
        acl:mode <http://www.w3.org/ns/auth/acl#Read>, <http://www.w3.org/ns/auth/acl#Write>, <http://www.w3.org/ns/auth/acl#Append>, <http://www.w3.org/ns/auth/acl#Control>.
            
    <#${v4()}>
        a acl:Authorization;
        acl:accessTo    <./>;
        acl:default     <./> ;
        <http://www.w3.org/ns/auth/acl#agentClass> <http://xmlns.com/foaf/0.1/Agent>;
        acl:mode <http://www.w3.org/ns/auth/acl#Read>, <http://www.w3.org/ns/auth/acl#Write>, <http://www.w3.org/ns/auth/acl#Append>.
    `
}

export {aclTemplate}