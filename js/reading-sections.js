// Read-only navigation chunks. Preserves every original character across the
// section boundaries; no editorial headings or factual structure are invented.
export function readingSections(text,maxWords=850){
    if(typeof text!=='string')throw Error('Reading narrative must be text.');
    if(!Number.isInteger(maxWords)||maxWords<50)throw Error('Invalid section length.');
    const chunks=text.match(/(?:[^\r\n]|\r?\n(?![\t ]*\r?\n))*(?:\r?\n[\t ]*\r?\n)+|[\s\S]+$/g);
    // The paragraph matcher may be too restrictive for unusual line endings.
    // Reconstruct and use the original text in one section rather than lose bytes.
    if(!chunks || chunks.join('')!==text)return [{index:0,text}];
    // A pasted story may have no blank lines. Fall back to word landmarks,
    // still retaining the original whitespace character-for-character.
    const pieces=[];
    for(const chunk of chunks){
        if((chunk.match(/\S+/g)||[]).length<=maxWords){pieces.push(chunk);continue;}
        let segment='',count=0;
        for(const token of (chunk.match(/\s+|\S+/g)||[])){
            if(!/^\s+$/.test(token)){
                if(count===maxWords){pieces.push(segment);segment='';count=0;}
                count++;
            }
            segment+=token;
        }
        if(segment)pieces.push(segment);
    }
    const groups=[];
    let buffer='',words=0;
    for(const chunk of pieces){
        const count=(chunk.match(/\S+/g)||[]).length;
        if(buffer && words+count>maxWords){groups.push(buffer);buffer='';words=0;}
        buffer+=chunk;words+=count;
    }
    if(buffer)groups.push(buffer);
    return (groups.length?groups:['']).map((part,index)=>({index,text:part}));
}
