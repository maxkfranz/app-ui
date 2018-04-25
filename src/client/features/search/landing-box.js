const h = require('react-hyperscript');
const Link = require('react-router-dom').Link;
const classNames = require('classnames');
const queryString = require('query-string');
const { ServerAPI } = require('../../services');
const databases = require('../../common/config').databases;
const Loader = require('react-loader');
const _ = require('lodash');

const linkBuilder= (source,geneQuery)=>{
  let genes={}; 
  const geneArray=geneQuery.geneInfo;
  genes.unrecognized=geneQuery.unrecognized;
  const duplicates = new Set();
  geneArray.forEach(gene=>{
    if(!duplicates.has(gene.convertedAlias)){
      genes[gene.initialAlias]={[source]:gene.convertedAlias};
      duplicates.add(gene.convertedAlias);
    }
  });
  return genes;
};
const pcFallback = (unrecognized,genes) => {
 return unrecognized.map(entry=>{
    if(!_.findKey(genes,entry)){
     return ServerAPI.pcQuery('search', {q:entry,entry:'entityreference'}).then((search)=>{
        const hits=search.searchHit;
        if(hits[0]){
         genes[entry]={'Uniprot': _.compact(hits.map(hit=>{
           hit =_.reverse(hit.uri.split('/'));
           return hit[1]==='uniprot' ? hit[0] : false;
          }))[0]};
        }
      });
    }
  });
};

const getNcbiInfo = (ncbiIds,genes) => {
  return ServerAPI.getGeneInformation(ncbiIds).then(result=>{
    const geneResults=result.result;
    return geneResults.uids.map(gene=>{
      const originalSearch = _.findKey(genes,entry=> entry['NCBI Gene']===gene);
      const links=_.mapValues(genes[originalSearch],(value,key)=>{
        let link = databases.filter(databaseValue => key.toUpperCase() === databaseValue.database.toUpperCase());
        return link[0].url + link[0].search + value.replace(/[^a-zA-Z0-9-_]/g, '');
      });
      return {
        databaseID:gene,
        name:geneResults[gene].nomenclaturename,
        function: geneResults[gene].summary,
        hgncSymbol:genes[originalSearch]['Gene Cards'],
        otherNames: geneResults[gene].otheraliases ? geneResults[gene].otheraliases:'',
        showMore:{full:!(geneResults.uids.length>1),function:false,synonyms:false},
        links:links
      };
    });
  });
};

const getUniprotInfo= (uniprotIds,genes) => {
  const databaseNames=new Map ([['GeneCards','Gene Cards'],['HGNC','HGNC'],['GeneID','NCBI Gene']]);
  return ServerAPI.getUniprotnformation(uniprotIds).then(result=>{
    return result.map(gene=>{
      const originalSearch = _.findKey(genes,entry=> entry['Uniprot']===gene.accession);
      let links={Uniprot:gene.accession};
      gene.dbReferences.forEach(db=>_.assign(links, databaseNames.has(db.type) ? {[databaseNames.get(db.type)]:db.id}:{}));
      const hgncSymbol = links.HGNC;
      links = _.mapValues(links,(value,key)=>{
        let link = databases.filter(databaseValue => key.toUpperCase() === databaseValue.database.toUpperCase());
        return link[0].url + link[0].search + value.replace(/[^a-zA-Z0-9:]/g, '');
      });
      return {
        databaseID:gene.accession,
        name:gene.gene[0].name.value,
        function: gene.comments && gene.comments[0].type==='FUNCTION' ?gene.comments[0].text[0].value:'',
        hgncSymbol:hgncSymbol,
        showMore:{full:true,function:false,synonyms:false},
        links:links
      };
    });
  });
};
/*Gets info for a landing box
input: 'TP53'
output: [{
function:"This gene encodes ..."
id:"7157"
links:{Gene Cards:"http://identifiers.org/genecards/TP53"...}
name:"tumor protein p53"
showMore:{full:false,function:false,synonyms:false}
synonyms:"TP53, BCC7, LFS1, P53, TRP53"
}]
*/
const getLandingResult= (query)=> {
  const q=query.trim();
  return Promise.all([
    ServerAPI.geneQuery({genes: q,target: 'NCBIGENE'}).then(result=>linkBuilder('NCBI Gene',result)),
    ServerAPI.geneQuery({genes: q,target: 'HGNCSYMBOL'}).then(result=>linkBuilder('Gene Cards',result)),
    ServerAPI.geneQuery({genes: q,target: 'UNIPROT'}).then(result=>linkBuilder('Uniprot',result)),
    ServerAPI.geneQuery({genes: q,target: 'HGNC'}).then(result=>linkBuilder('HGNC',result)),
  ]).then(values=>{
    let genes=values[0];
    _.tail(values).forEach(gene=>_.mergeWith(genes,gene,(objValue, srcValue)=>_.assign(objValue,srcValue)));
   return genes;
  }).then(genes=>Promise.all(pcFallback(genes.unrecognized,genes)).then(()=>genes)).then((genes)=>{
      let ncbiIds=[],uniprotIds=[];
      _.forEach(genes,gene=>{
        if(gene['NCBI Gene']){
          ncbiIds.push(gene['NCBI Gene']);
        }
        else if(gene['Uniprot']){
          uniprotIds.push(gene['Uniprot']);
        }
      });
      let landingBoxes=[];
       if(!_.isEmpty(ncbiIds)){
        landingBoxes.push(getNcbiInfo(ncbiIds,genes));
       }
       if(!_.isEmpty(uniprotIds)){
        landingBoxes.push(getUniprotInfo(uniprotIds,genes));
       }
      return Promise.all(landingBoxes).then(landingBoxes=> {
        landingBoxes=_.flatten(landingBoxes);
        if(landingBoxes.length>1){landingBoxes.forEach(box=>box.showMore.full=false);}
        return landingBoxes;
      });
  });
};

const handelShowMoreClick= (controller,landing,varToToggle,index) => {
  landing[index].showMore[varToToggle]=!landing[index].showMore[varToToggle];
  controller.setState({ landing:landing }); 
};

const expandableText = (controller,landing,length,text,separator,type,cssClass,toggleVar,index)=>{
  let result = null;
  const varToToggle= landing[index].showMore[toggleVar];
  const textToUse= (varToToggle || text.length<=length)?
    text+' ': _.truncate(text,{length:length,separator:separator});
    result=[h(`${type}`,{className:cssClass,key:'text'},textToUse)];
  if(text.length>length){
    result.push(h(`${type}.search-landing-link`,{onClick: ()=> handelShowMoreClick(controller, landing, toggleVar, index),key:'showMore'},
    varToToggle ? '« hide': 'show »'));
  }
  return result;
};

const interactionsLink = (source,text)=> 
  h(Link, {to: { pathname: '/interactions',search: queryString.stringify({source: source})}, 
    target: '_blank', className: 'search-landing-interactions', key:'interactions' 
  }, [h('button.search-landing-button', text)]);

/*Generates a landing box
input: {controller,[{
function:"This gene encodes ..."
id:"7157"
links:{Gene Cards:"http://identifiers.org/genecards/TP53"...}
name:"tumor protein p53"
showMore:{full:false,function:false,synonyms:false}
synonyms:"TP53, BCC7, LFS1, P53, TRP53"
}]}
output: html for a landing box
*/
const landingBox = (props) => {
  const landing=props.landing;
  const controller=props.controller;
  if (controller.state.landingLoading ) {
    return h('div.search-landing', [
      h('div.search-landing-innner',[
        h(Loader, { loaded:false , options: { color: '#16A085', position:'relative', top: '15px' }})]
      )]
    );
  }
  const landingHTML= landing.map((box,index)=>{
    const multipleBoxes = landing.length>1;
    const title = [h('strong.search-landing-title-text',{key:'name'},box.name),];
    if(multipleBoxes){
      title.push(h('strong.material-icons',{key:'arrow'},landing[index].showMore.full? 'expand_less': 'expand_more'));
    }
    let hgncSymbol='';
    if(box.hgncSymbol){ 
      hgncSymbol=h('i.search-landing-small','Official Symbol: '+box.hgncSymbol);
    }
    let otherNames=[];
    if(box.otherNames){ 
      otherNames=expandableText(controller,landing,16,'Other Names: '+box.otherNames,',','i','search-landing-small','synonyms',index);
    }
    let functions=[];
    if(box.function){
      functions=expandableText(controller,landing,260, box.function,/\s/g,'span','search-landing-function','function',index);
    } 
    let links=[];
    _.forIn((box.links),(value,key)=>{
      links.push(h('a.search-landing-link',{key: key, href: value},key));
    });
    return [ 
      h('div.search-landing-title',{key:'title',
        onClick: () => {if(multipleBoxes){handelShowMoreClick(controller,landing, 'full', index);}},
        className:classNames('search-landing-title',{'search-landing-title-multiple':multipleBoxes}),
      },[title]),
      box.showMore.full && 
      h('div.search-landing-innner',{key: box.ncbiId},[ 
        h('div.search-landing-section',{key: 'ids'},[hgncSymbol,otherNames]),
        h('div.search-landing-section',{key: 'functions'},[functions]),
        h('div.search-landing-section',{key: 'links'},[links]),
        interactionsLink(box.ncbiId,'View Interactions')
      ])
    ];    
  });
  if(landing.length>1){
    landingHTML.push(interactionsLink(landing.map(entry=>entry.id),'View Interactions Between Entities'));
  }

  return h('div.search-landing',landingHTML);
};

module.exports = {getLandingResult,landingBox};
