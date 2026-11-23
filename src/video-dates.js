export function validLectureDate(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;
  const date=new Date(value+'T00:00:00Z');
  return !Number.isNaN(+date)&&date.toISOString().slice(0,10)===value;
}
// Post publication timestamps are deliberately not a source of lecture dates.
export function lectureDateFrom({title='',text='',term=''}={}) {
  const termYear=String(term).match(/\b(20\d{2})\b/)?.[1];
  for(const [source,value]of [['title',title],['body',text]]) {
    const dates=new Set();
    for(const match of String(value).replace(/https?:\/\/\S+/g,'').matchAll(/(?<![\dA-Za-z])(?:(20\d{2})\s*(?:[.\/-]|년)\s*)?(\d{1,2})\s*([.\/-]|월)\s*(\d{1,2})(?:일)?(?!\d)/g)) {
      const year=match[1]||termYear;if(!year||!match[1]&&['-','.'].includes(match[3]))continue;
      const date=`${year}-${match[2].padStart(2,'0')}-${match[4].padStart(2,'0')}`;
      if(validLectureDate(date))dates.add(date);
    }
    if(dates.size===1)return {lectureDate:[...dates][0],lectureDateSource:source};
    if(dates.size>1)return {lectureDate:null,lectureDateSource:'ambiguous'};
  }
  return {lectureDate:null,lectureDateSource:null};
}
