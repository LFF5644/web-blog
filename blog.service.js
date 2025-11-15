// CREATED 22.02.2025 AT 15:13
const blogArticlesFile="data/blog/articles.json";
const blogArticlesDir="data/blog/";
const defaultBlogFileName="blog.txt";

const {
	createDirAsync,
	readFileAsync,
	readJsonFileAsync,
	writeJsonFileAsync,
	writeFileAsync,
	rmFileAsync,
	renameAsync,
	existsAsync,
	tofsStr,
}=globals.functions;

const VISITOR_EXPIRE_TIME=1e3*60*60*5; // time that the visitor is in the visitors array (5H)
const VISITOR_ONLINE_TIME=1e3*60*10; // time that the visitor have to read the blog unil he counts as new visitor (10M)

let isStarting=false;

const getDateUpsideDown=(date=new Date(),sub=".")=> date.getFullYear()+sub+String(date.getMonth()+1).padStart(2,0)+sub+String(date.getDate()).padStart(2,0);
const getTimeUpsideDown=(date=new Date,sub=":")=> String(date.getHours()).padStart(2,0)+sub+String(date.getMinutes()).padStart(2,0);
const excludeTemplate=(object,template)=>Object.fromEntries(Object.entries(object).filter(item=>typeof(item[1])==="object"||template[item[0]]!==item[1]));

const loadBlogArticlesFile=async()=>{
	log("Load: "+blogArticlesFile);
	const articles=await readJsonFileAsync(blogArticlesFile);
	//console.log(articles);
	if(!articles) this.articles=[];
	else this.articles=articles.map(this.getArticleTemplate);
}
const saveBlogArticlesFile=()=>{
	const template=this.articleTemplate;
	let articles=this.getArticles().map(item=>({...excludeTemplate(item,template),articleText:undefined}));
	if(articles.length===0){
		log("dont save empty file: "+blogArticlesFile);
		//return rmFileAsync(blogArticlesFile);
	}
	else{
		log("Save: "+blogArticlesFile);
		//console.log(articles);
		return writeJsonFileAsync(blogArticlesFile,articles);
	}
}
const saveSavedArticleFile=async()=>{
	log("Save: "+blogArticlesDir+"saved/article.json");
	await createDirAsync(blogArticlesDir+"saved");
	await writeJsonFileAsync(blogArticlesDir+"saved/article.json",excludeTemplate(this.savedArticle,this.articleTemplate));
}
const loadSavedArticleFile=async()=>{
	log("Load: "+blogArticlesDir+"saved/article.json");
	const article=await readJsonFileAsync(blogArticlesDir+"saved/article.json");
	if(!article) this.savedArticle=this.getArticleTemplate({folder:"saved"});
	else this.savedArticle=this.getArticleTemplate(article);
}

this.createArticle=async(article)=>{
	log("create article...");
	article=this.getArticleTemplate(article);
	const articleCreatedDate=new Date(article.created);
	if(!article.title||!article.description) throw new Error("blog article not have description or title, but its required!");
	if(!article.articleText&&(!article.folder||!article.articleFile)) throw new Error("blog article is not given!");

	if(!article.id) article.id=this.articles.length+1;

	if(!article.folder||article.folder==="saved"){
		const newFolder=getDateUpsideDown(articleCreatedDate,"-")+"_"+getTimeUpsideDown(articleCreatedDate,"-");
		await createDirAsync(blogArticlesDir+newFolder);
		if(article.folder==="saved"){
			for(const file of article.files){
				log(`moving '${blogArticlesDir}': 'saved/${file}' => '${newFolder}/' ...`);
				await renameAsync(blogArticlesDir+"saved/"+file,blogArticlesDir+newFolder+"/"+file);
			}
			log("moved "+article.files.length+" successfully!")
		}
		article.folder=newFolder;
	}
	if(!article.articleFile&&article.articleText){
		article.articleFile=defaultBlogFileName;
		await writeFileAsync(blogArticlesDir+article.folder+"/"+defaultBlogFileName,article.articleText);
		log("written: "+blogArticlesDir+article.folder+"/"+defaultBlogFileName,article.articleText+" with "+article.articleText.length/1024+" KB");
		article.articleText=undefined;
		delete article.articleText;
	}
	log("NEW ARTICLE CREATED: "+article.title+", files: "+article.files.length+", visibility: "+article.visibility);
	this.articles.push(article);
	this.saveRequired=true;
	return article;
}
this.editArticle=async(article)=>{
	const lastArticle=this.getArticle(article.id);
	if(!lastArticle) throw new Error("Article not exist, edit not allowed!");
	article={
		...this.articleTemplate,
		...lastArticle,
		...article,
	};
	const articleIndex=this.getArticleIndex(article.id);
	if(articleIndex===-1) throw new Error("article not found");
	if(article.sourceFolder){
		const source=article.sourceFolder;
		delete article.sourceFolder;
		for(const file of article.files){
			const fileSourcePath=blogArticlesDir+source+"/"+file;
			const fileTargetPath=blogArticlesDir+article.folder+"/"+file;
			if(!await existsAsync(fileSourcePath)) continue;
			log("moving: "+fileSourcePath+" => "+fileTargetPath);
			await renameAsync(fileSourcePath,fileTargetPath);
		}
	}
	if(article.articleText){
		log("edit: Article Text...");
		const file=blogArticlesDir+article.folder+"/"+article.articleFile;
		await writeFileAsync(file,article.articleText);
		delete article.articleText;
	}
	log("edit: Article MetaData");
	this.articles[articleIndex]=article;
	this.saveRequired=true;
}
this.getArticles=()=>this.articles;
this.existArticle=id=> this.articles.some(item=>item.id===id);
this.getArticleIndex=id=> this.articles.findIndex(item=>item.id===id);
this.getArticle=id=> this.articles.find(item=>item.id===id);
this.getArticleByFolder=folder=> this.articles.find(item=>item.folder===folder);
this.getArticleText=id=>{
	const article=this.articles.find(item=>item.id===id);
	if(!article) throw new Error("article with id "+id+", dont exist!");
	const file=blogArticlesDir+article.folder+"/"+article.articleFile;
	return readFileAsync(file,"utf-8");
}
this.executeBlogArticleCode=async(article)=>{
	// inspired by L3P3/rtjscomp.
	let id,rawArticleText;
	id=article.id;
	if(article.articleText) rawArticleText=article.articleText;
	else rawArticleText=await this.getArticleText(id);

	let index=0;
	let staticData=true;
	let articleTextFunction="(async function(article,data,globals,log){let res='';";
	const formartStatic=text=>(text
		.split("\n").join("<br>")
		.split("\\").join("\\\\")
		.split("\r").join("")
		//.split('"').join('\"') trying to fix err
		.split("'").join("\'")
		.split("    ").join("&#09;")
		.split("\t").join("&#09;")
	);
	const formartDynamic=text=>(
		string_codify(
			text
		)
	);

	while(index<rawArticleText.length){
		const text=rawArticleText.substring(index);
		if(staticData){ // now we in text chunk
			const indexEnd=text.indexOf("<?");
			if(indexEnd===-1){
				articleTextFunction+="res+='"+formartStatic(text)+"';";
				index=rawArticleText.length;
			}
			else{
				articleTextFunction+="res+='"+formartStatic(text.substring(0,indexEnd))+"';";
				staticData=false;
				index+=indexEnd+2;
			}
		}
		else if(!staticData){ // now we in code chunck
			let dynamicValue=false;
			if(text.substring(0,1)==="=") dynamicValue=true;
			const indexEnd=text.indexOf("?>");
			if(indexEnd===-1){
				if(!dynamicValue) articleTextFunction+=formartDynamic(text);
				else if(dynamicValue) articleTextFunction+="res+=''+"+text.substring(1)+";";
				articleTextFunction+='res+="<hr style=color:red><b style=color:red>HEY YOU FORGOT ?&gt; at the end!</b>");';
				index=rawArticleText.length;
				staticData=true;
			}
			else{
				if(!dynamicValue) articleTextFunction+=text.substring(0,indexEnd);
				else if(dynamicValue) articleTextFunction+="res+=''+"+text.substring(1,indexEnd)+";";
				index+=indexEnd+2;
				staticData=true;
			}
		}
	}
	articleTextFunction+="return res;});";

	let articleText='';
	let articleFunction;
	try{
		articleFunction=eval(articleTextFunction);
	}catch(e){
		log("error building function: "+e);
		throw e;
	}
	try{
		const media="/blog/get/"+article.id+"/";
		const data=(type,...args)=>{
			if(type==="img"||type==="image"){
				const dataTemplate={
					alt: null,
					clickable: true,
				}
				let [src,data]=args;
				data={...dataTemplate,...data};
				let {clickable,alt}=data;

				if(!alt) alt=src;
				src=media+src;
				src=src.includes(" ")||src.includes("=")?('"'+src+'"'):src;
				alt=alt.includes(" ")||alt.includes("=")?('"'+alt+'"'):alt;
				let result='';
				result+="<p>";
				if(clickable) result+=`<a target=_blank href=${src}>`
				result+=`<img loading=lazy class=media src=${src}${data.alt?(' alt='+alt):''}>`;
				if(clickable) result+=`</a>`;
				result+="</p>";
				return result;
			}
			else if(type==="link"){
				const dataTemplate={
					download: null,
					openBlank: true,
				};
				let [href,text,data]=args;
				data={...dataTemplate,...data};
				let {download,openBlank}=data;
				let result='<a ';
				href=href.split("$MEDIA/").join(media);
				href=href.includes(" ")||href.includes("=")?('"'+href+'"'):href;
				if(download) download=download.includes(" ")||download.includes("=")?('"'+download+'"'):'';
				if(openBlank) openBlank=" target=_blank";
				result+=`href=${href}${openBlank?openBlank:''}${download?(" download="+download):''}>`;
				result+=text+"</a>";
				return result;
			}
		}
		articleText=await articleFunction(article,data,globals,a=>log_o("blog/"+article.folder+": "+a));
	}
	catch(e){
		log("error executeing blog article text code: "+e);
		throw e;
	}

	return articleText;
}
this.articleTemplate={
	id: undefined,
	created: undefined,
	lastEdit: undefined,
	title: null,
	description: null,
	folder: null,
	files:[],
	articleFile: null,
	visibility: "everyone",
	//writtenByUser: "lff",
};
this.getArticleTemplate=(article={})=>{
	const now=Date.now();
	return {
		...this.articleTemplate,
		id: now,
		created: now,
		lastEdit: now,
		...article,
	};
}
this.getSavedArticle=()=> this.savedArticle;
this.setSavedArticle=article=>{
	this.savedArticle=article;
	this.saveRequired=true;
};
this.addFileToSavedArticle=async(name,buffer)=>{
	log("Upload: "+blogArticlesDir+"saved/"+name);
	if(this.savedArticle.files.includes(name)) throw new Error("file already exists!");
	await createDirAsync(blogArticlesDir+"saved");
	await writeFileAsync(blogArticlesDir+"saved/"+name,buffer);
	this.savedArticle.files.push(name);
	this.saveRequired=true;
}
this.removeFileFromSavedArticle=async file=>{
	log("DEL: "+blogArticlesDir+"saved/"+file);
	if(!this.savedArticle.files.includes(file)) throw new Error("file "+file+" not exist!");
	this.savedArticle.files=this.savedArticle.files.filter(item=>item!==file);
	this.saveRequired=true;
	await rmFileAsync(blogArticlesDir+"saved/"+file);
	return this.savedArticle.files;
}
this.removeFileFromArticle=async(id,file)=>{
	const index=this.getArticleIndex(id);
	if(index===-1) throw new Error("article id not found!");
	if(!this.articles[index].files.includes(file)) throw new Error("file "+file+" not exist!");
	log("DEL: "+blogArticlesDir+this.articles[index].folder+"/"+file);
	this.articles[index].files=this.articles[index].files.filter(item=>item!==file);
	this.saveRequired=true;
	await rmFileAsync(blogArticlesDir+this.articles[index].folder+"/"+file);
	return this.articles[index].files;
}
this.addFileToArticle=async(id,name,buffer)=>{
	const index=this.getArticleIndex(id);
	const article=this.getArticle(id);
	if(!article||index===-1) throw new Error("id not found!");
	log("Upload: "+blogArticlesDir+article.folder+"/"+name);
	if(article.files.includes(name)) throw new Error("file already exists!");
	await createDirAsync(blogArticlesDir+article.folder);
	await writeFileAsync(blogArticlesDir+article.folder+"/"+name,buffer);
	article.files.push(name);
	this.articles[index].files.push(name);
	this.saveRequired=true;
	return this.articles[index].files;
}
this.visitorAdd=({
	articleId,
	username, // null if user not logined
	ip, bot,
	browser, // user_agent
})=>{
	if(!this.existArticle(articleId)) throw new Error("visitorAdd: articleId not exists: "+articleId);
	if(username==="lff"||bot) return; // to reduce visitors ;)
	const now=Date.now();
	const visitorObject=[now,articleId,username,ip,browser];

	let remove=[];
	let visitorOnline=false;
	let foundVisitor=false;
	for(let index=0; index<this.visitors.length; index+=1){
		const item=this.visitors[index];
		let removed=false;
		const visitorAge=now-item[0];
		if(visitorAge>VISITOR_EXPIRE_TIME){
			if(!removed) remove.push(item[0]);
			this.visitorCounters[item[1]]=(this.visitorCounters[item[1]]||0)+1; // adding one more visitor for artice
			removed=true;
			log("adding visitor permernently for: "+articleId);
		}
		if( // Complicated, but checks for existing visitor.
			item[1]===articleId&&
			item[2]===username&&
			(
				username&&item[2]||
				(
					item[2]===null&&
					item[3]===ip&&
					item[4]===browser
				)
			)
		){
			foundVisitor=true;
			//log("you are: "+item.join("; "));
			if(visitorAge<VISITOR_ONLINE_TIME){
				if(!removed) remove.push(item[0]);
				visitorOnline=true;
				removed=true;
			}
		}
	}
	//log("removing: "+remove.length);
	this.visitors=this.visitors.filter(item=>!remove.some(i=>i===item[0])); // removes all visitors in "remove"
	if(foundVisitor&&visitorOnline){
		this.visitors.push(visitorObject);
		log("online visitor, for: "+articleId);
	}
	else if(foundVisitor&&!visitorOnline){
		log("visitor is offline, for: "+articleId);
	}
	else if(!foundVisitor){
		this.visitors.push(visitorObject);
		log("new visitor for: "+articleId);
	}
};
this.getVisitors=(id,time)=>{ // returns number of visitors of an article.
	if(!this.existArticle(id)) throw new Error("getVisitors: articleId: "+id+" not exists!");
	if(!time||time>VISITOR_EXPIRE_TIME) return (this.visitorCounters[id]||0)+this.visitors.filter(item=>item[1]===id).length;
	const now=Date.now();
	return this.visitors.filter(item=>item[1]===id&&(now-item[0])<time).length;
}

this.start=async()=>{
	this.articles=[];
	this.savedArticle={};
	this.articlesFunctionCache=[];
	this.visitors=[];
	this.visitorCounters={};
	this.serviceUptime=Date.now();
	isStarting=true;

	await createDirAsync("data/blog"); // erstellen des "blog" ordners im daten speicher!
	
	await loadBlogArticlesFile();
	await loadSavedArticleFile();

	this.saveInterval=setInterval(this.save,1e3*20); // autosave all 20s

	isStarting=false; // service started!
}
this.save=async required=>{
	const now=Date.now();
	if(isStarting||now-this.serviceUptime<1e3*10){
		log("Service is still starting DONT SAVE!! or service uptime is to low!");
		return;
	}
	if(this.saveRequired===true||required===true){
		log("saving "+this.articles.length+" articles to file.");
		await saveBlogArticlesFile();
		await saveSavedArticleFile();
		this.saveRequired=false;
		log("saved!");
	}
}
this.stop=async()=>{
	clearInterval(this.saveInterval);
	await this.save(true);
	this.serviceUptime=null;
}
