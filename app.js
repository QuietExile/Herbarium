(() => {
'use strict';

const APP_VERSION = '3.1.1-share-fallback';
const DB_NAME = 'prairie-herbarium-v3';
const DB_VERSION = 1;
const STORE = 'records';
const SETTINGS_KEY = 'prairieHerbariumSettingsV3';
const SYNC_META_KEY = 'prairieHerbariumSyncMetaV3';
const MASTER_FILENAME = 'PrairieHerbarium_Master.json';

const $ = id => document.getElementById(id);
const qsa = sel => [...document.querySelectorAll(sel)];
const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
const nowIso = () => new Date().toISOString();
const today = () => new Date().toISOString().slice(0,10);
const timeNow = () => new Date().toTimeString().slice(0,5);
const uid = () => crypto.randomUUID();

let db;
let currentPhotos = [];
let lifecyclePhotos = [];
let lifecycleEntries = [];
let recordViewMode = localStorage.getItem('recordViewModeV3') || 'list';
let tableSort = JSON.parse(localStorage.getItem('tableSortV3') || '{"key":"date","direction":"desc"}');
let lightboxPhotos = [];
let lightboxIndex = 0;
let lightboxScale = 1;

const TABLE_COLUMNS = [
  ['collectionNumber','Collection #',true],
  ['date','Collection date',true],
  ['commonName','Common name',true],
  ['scientificName','Scientific name',true],
  ['genus','Genus',true],
  ['family','Family',true],
  ['status','Status',true],
  ['habitat','Habitat',false],
  ['season','Season',false],
  ['weatherConditions','Weather',false],
  ['flowerColor','Flower color',false],
  ['phenology','Life stage',false],
  ['locationDescription','Location',false],
  ['map','Map',false],
  ['updatedAt','Last modified',false]
];
let visibleColumns = JSON.parse(localStorage.getItem('visibleColumnsV3') || 'null') ||
  TABLE_COLUMNS.filter(c => c[2]).map(c => c[0]);

const RECORD_FIELDS = [
  'collectionNumber','status','date','time','commonName','scientificName','genus','family','confidence','identificationNotes',
  'locationDescription','latitude','longitude','habitat','season','light','soilMoisture','soilType','weatherConditions','nearbyPlants',
  'growthForm','height','spread','flowerColor','abundance','phenology','fieldNotes',
  'pressDate','pressTime','paperChangeDate','paperChangeTime','dryDate','mountedDate','storageLocation','preservationNotes'
];

const LIFECYCLE_FIELDS = [
  'lifecycleDate','lifecycleTime','lifecycleStage','lifecycleHeight','lifecycleSpread','lifecycleCondition',
  'lifecycleFlowerAbundance','lifecycleFruitStage','lifecycleLeafCondition','lifecycleWeather','lifecycleNotes'
];

function syncMeta(){
  return {lastExport:'',lastImport:'',...(JSON.parse(localStorage.getItem(SYNC_META_KEY)||'{}'))};
}
function saveSyncMeta(meta){
  localStorage.setItem(SYNC_META_KEY,JSON.stringify(meta));
  renderSyncStatus();
}
function formatSyncDate(value){
  return value ? new Date(value).toLocaleString() : 'Never';
}
async function renderSyncStatus(){
  const rows=db?await allRecords():[];
  if($('syncRecordCount')) $('syncRecordCount').textContent=rows.length;
  const meta=syncMeta();
  if($('lastExportStatus')) $('lastExportStatus').textContent=formatSyncDate(meta.lastExport);
  if($('lastImportStatus')) $('lastImportStatus').textContent=formatSyncDate(meta.lastImport);
}

function toast(message){
  const box = $('toast');
  box.textContent = message;
  box.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.add('hidden'), 3500);
}

function settings(){
  return {
    collector:'David R.',
    prefix:'DR',
    locality:'Hartford, South Dakota',
    sequence:1,
    ...(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}'))
  };
}
function saveSettings(obj){ localStorage.setItem(SETTINGS_KEY, JSON.stringify(obj)); }

function openDB(){
  return new Promise((resolve,reject)=>{
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if(!database.objectStoreNames.contains(STORE)){
        const store = database.createObjectStore(STORE,{keyPath:'id'});
        store.createIndex('date','date');
        store.createIndex('collectionNumber','collectionNumber',{unique:false});
      }
    };
    request.onsuccess = () => { db = request.result; resolve(db); };
    request.onerror = () => reject(request.error);
  });
}
function tx(mode='readonly'){ return db.transaction(STORE,mode).objectStore(STORE); }
function allRecords(){
  return new Promise((resolve,reject)=>{
    const req = tx().getAll();
    req.onsuccess = () => resolve(req.result.map(normalizeRecord));
    req.onerror = () => reject(req.error);
  });
}
function getRecord(id){
  return new Promise((resolve,reject)=>{
    const req = tx().get(id);
    req.onsuccess = () => resolve(req.result ? normalizeRecord(req.result) : null);
    req.onerror = () => reject(req.error);
  });
}
function putRecord(record){
  return new Promise((resolve,reject)=>{
    const req = tx('readwrite').put(normalizeRecord(record));
    req.onsuccess = () => resolve(record);
    req.onerror = () => reject(req.error);
  });
}
function deleteRecordById(id){
  return new Promise((resolve,reject)=>{
    const req = tx('readwrite').delete(id);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

function normalizePhoto(photo){
  if(!photo) return null;
  if(typeof photo === 'string') return {name:'photo.jpg',data:photo};
  if(typeof photo.data === 'string') return {name:photo.name || 'photo.jpg',data:photo.data};
  if(photo.data && typeof photo.data.data === 'string'){
    return {name:photo.name || photo.data.name || 'photo.jpg',data:photo.data.data};
  }
  return null;
}
function normalizePhotos(list){ return (Array.isArray(list) ? list : []).map(normalizePhoto).filter(Boolean); }
function normalizeRecord(record){
  const r = {...record};
  r.id ||= uid();
  r.createdAt ||= nowIso();
  r.updatedAt ||= r.createdAt;
  r.photos = normalizePhotos(r.photos);
  r.lifecycleObservations = (r.lifecycleObservations || []).map(entry => ({
    ...entry,
    id: entry.id || uid(),
    photos: normalizePhotos(entry.photos)
  }));
  if(!r.genus && r.scientificName) r.genus = r.scientificName.trim().split(/\s+/)[0] || '';
  if(!r.season && r.date) r.season = seasonForDate(r.date);
  if(typeof r.weatherConditions === 'string'){
    r.weatherConditions = r.weatherConditions.split(';').map(x=>x.trim()).filter(Boolean);
  }
  if(!Array.isArray(r.weatherConditions)) r.weatherConditions = [];
  return r;
}

function seasonForDate(dateString){
  const month = Number((dateString || '').slice(5,7));
  if([3,4,5].includes(month)) return 'Spring';
  if([6,7,8].includes(month)) return 'Summer';
  if([9,10,11].includes(month)) return 'Fall / autumn';
  if([12,1,2].includes(month)) return 'Winter';
  return '';
}
function collectionNumber(){
  const s = settings();
  return `${s.prefix || 'DR'}-${new Date().getFullYear()}-${String(s.sequence || 1).padStart(3,'0')}`;
}
function incrementSequence(){
  const s = settings();
  s.sequence = Number(s.sequence || 1) + 1;
  saveSettings(s);
}

function setView(name){
  qsa('.view').forEach(v => v.classList.toggle('active', v.id === `${name}View`));
  qsa('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  if(name === 'dashboard') renderDashboard();
  if(name === 'records') renderRecords();
}

function getValue(id){
  const el = $(id);
  if(!el) return '';
  if(el.multiple) return [...el.selectedOptions].map(o=>o.value);
  return el.value;
}
function setValue(id,value){
  const el = $(id);
  if(!el) return;
  if(el.multiple){
    const values = Array.isArray(value) ? value : [];
    [...el.options].forEach(o => o.selected = values.includes(o.value));
  }else{
    el.value = value ?? '';
  }
}

function resetRecordForm(){
  $('recordForm').reset();
  $('recordId').value = '';
  $('recordHeading').textContent = 'New specimen record';
  $('deleteRecordBtn').classList.add('hidden');
  const dt = new Date();
  setValue('collectionNumber', collectionNumber());
  setValue('status','field');
  setValue('date', today());
  setValue('time', timeNow());
  setValue('season', seasonForDate(today()));
  currentPhotos = [];
  lifecycleEntries = [];
  renderPhotos();
  renderLifecycleList();
  updateMapPreview();
  updatePaperChange();
}
async function editRecord(id){
  const r = await getRecord(id);
  if(!r) return;
  $('recordId').value = r.id;
  $('recordHeading').textContent = r.collectionNumber || 'Specimen record';
  $('deleteRecordBtn').classList.remove('hidden');
  RECORD_FIELDS.forEach(field => setValue(field,r[field]));
  currentPhotos = normalizePhotos(structuredClone(r.photos));
  lifecycleEntries = structuredClone(r.lifecycleObservations || []);
  renderPhotos();
  renderLifecycleList();
  updateMapPreview();
  updatePaperChange(false);
  setView('record');
  window.scrollTo({top:0,behavior:'smooth'});
}
function recordFromForm(){
  const existingId = $('recordId').value;
  const obj = {
    id: existingId || uid(),
    createdAt: existingId ? undefined : nowIso(),
    updatedAt: nowIso()
  };
  RECORD_FIELDS.forEach(field => obj[field] = getValue(field));
  obj.photos = structuredClone(currentPhotos);
  obj.lifecycleObservations = structuredClone(lifecycleEntries);
  return normalizeRecord(obj);
}
async function saveRecord(event){
  event.preventDefault();
  const wasNew = !$('recordId').value;
  const old = wasNew ? null : await getRecord($('recordId').value);
  const record = recordFromForm();
  if(old?.createdAt) record.createdAt = old.createdAt;
  await putRecord(record);
  if(wasNew) incrementSequence();
  $('recordId').value = record.id;
  $('recordHeading').textContent = record.collectionNumber;
  $('deleteRecordBtn').classList.remove('hidden');
  toast('Record saved');
  await renderDashboard();
}
async function duplicateRecord(){
  const original = recordFromForm();
  const copy = normalizeRecord({
    ...original,
    id:uid(),
    collectionNumber:collectionNumber(),
    createdAt:nowIso(),
    updatedAt:nowIso(),
    photos:structuredClone(original.photos),
    lifecycleObservations:structuredClone(original.lifecycleObservations)
  });
  await putRecord(copy);
  incrementSequence();
  await editRecord(copy.id);
  toast('Record duplicated');
}
async function removeCurrentRecord(){
  const id = $('recordId').value;
  if(!id || !confirm('Delete this record permanently?')) return;
  await deleteRecordById(id);
  resetRecordForm();
  setView('records');
  toast('Record deleted');
}

function validCoordinates(lat,lon){
  const a=Number(lat), b=Number(lon);
  return Number.isFinite(a)&&Number.isFinite(b)&&a>=-90&&a<=90&&b>=-180&&b<=180;
}
function mapUrls(lat,lon){
  const a=Number(lat), b=Number(lon), d=.006;
  const bbox=[b-d,a-d,b+d,a+d].join(',');
  return {
    google:`https://www.google.com/maps?q=${a},${b}`,
    osm:`https://www.openstreetmap.org/?mlat=${a}&mlon=${b}#map=17/${a}/${b}`,
    embed:`https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${a},${b}`)}`
  };
}
function updateMapPreview(){
  const lat=$('latitude').value, lon=$('longitude').value;
  if(!validCoordinates(lat,lon)){
    $('mapPreview').classList.add('hidden');
    $('locationMap').removeAttribute('src');
    return;
  }
  const urls=mapUrls(lat,lon);
  $('googleMapsLink').href=urls.google;
  $('openStreetMapLink').href=urls.osm;
  $('locationMap').src=urls.embed;
  $('mapPreview').classList.remove('hidden');
}
function captureGPS(){
  if(!navigator.geolocation){ toast('Geolocation is not supported'); return; }
  $('gpsStatus').textContent='Locating…';
  navigator.geolocation.getCurrentPosition(pos=>{
    $('latitude').value=pos.coords.latitude.toFixed(6);
    $('longitude').value=pos.coords.longitude.toFixed(6);
    $('gpsStatus').textContent=`Accuracy ±${Math.round(pos.coords.accuracy)} m`;
    updateMapPreview();
  },err=>{
    $('gpsStatus').textContent=err.message;
  },{enableHighAccuracy:true,timeout:15000,maximumAge:0});
}

function updatePaperChange(write=true){
  const d=$('pressDate').value, t=$('pressTime').value;
  if(!d||!t){ if(write){$('paperChangeDate').value='';$('paperChangeTime').value='';} return; }
  const dt=new Date(`${d}T${t}`);
  if(Number.isNaN(dt.getTime())) return;
  dt.setHours(dt.getHours()+24);
  if(write){
    $('paperChangeDate').value=dt.toISOString().slice(0,10);
    $('paperChangeTime').value=dt.toTimeString().slice(0,5);
  }
}
function openCalendarReminder(){
  const d=$('paperChangeDate').value, t=$('paperChangeTime').value;
  if(!d||!t){ toast('Enter press date and time first'); return; }
  const start=new Date(`${d}T${t}`);
  const end=new Date(start.getTime()+15*60000);
  const fmt=x=>x.toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const title='Replace newspaper and blotting paper';
  const details=`Collection: ${$('collectionNumber').value || ''}\nPlant: ${$('commonName').value || $('scientificName').value || 'Unidentified plant'}\nReplace newspaper and blotting paper and inspect the specimen for moisture or mold.`;
  const url=`https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(title)}&dates=${fmt(start)}/${fmt(end)}&details=${encodeURIComponent(details)}`;
  window.open(url,'_blank','noopener');
}

function resizeImage(file,max=1600,quality=.82){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();
    reader.onerror=()=>reject(reader.error);
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('Could not read image'));
      img.onload=()=>{
        const scale=Math.min(1,max/Math.max(img.width,img.height));
        const canvas=document.createElement('canvas');
        canvas.width=Math.round(img.width*scale);
        canvas.height=Math.round(img.height*scale);
        canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
        resolve({name:file.name || 'photo.jpg',data:canvas.toDataURL('image/jpeg',quality)});
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function addPhotoFiles(files,target,render){
  const images=[...(files||[])].filter(f=>f?.type?.startsWith('image/'));
  for(const file of images){
    try{ target.push(await resizeImage(file)); }
    catch(err){ console.error(err); toast(`Could not add ${file.name || 'image'}`); }
  }
  render();
}
function bindDropZone(id,target,render){
  const zone=$(id);
  ['dragenter','dragover'].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.add('drag-over');}));
  ['dragleave','drop'].forEach(type=>zone.addEventListener(type,e=>{e.preventDefault();zone.classList.remove('drag-over');}));
  zone.addEventListener('drop',e=>addPhotoFiles(e.dataTransfer.files,target,render));
  zone.addEventListener('paste',e=>{
    const files=[...e.clipboardData.items].filter(i=>i.kind==='file'&&i.type.startsWith('image/')).map(i=>i.getAsFile()).filter(Boolean);
    addPhotoFiles(files,target,render);
  });
}
function moveItem(list,from,to){
  if(to<0||to>=list.length||from===to) return;
  const [item]=list.splice(from,1); list.splice(to,0,item);
}
function photoMarkup(photo,index,type){
  return `<div class="photo-item ${index===0?'primary-photo':''}" draggable="true" data-photo-type="${type}" data-index="${index}">
    <button type="button" class="photo-open"><img src="${photo.data}" alt="Plant photograph"></button>
    ${index===0?'<span class="primary-label">Primary</span>':''}
    <div class="photo-controls">
      <button type="button" data-action="left">←</button>
      <button type="button" data-action="right">→</button>
      <button type="button" data-action="primary">★</button>
      <button type="button" data-action="delete">×</button>
    </div>
  </div>`;
}
function bindPhotoGrid(container,list,render){
  let dragIndex=null;
  qsa(`#${container.id} .photo-item`).forEach(item=>{
    const index=()=>Number(item.dataset.index);
    item.querySelector('.photo-open').onclick=e=>{e.stopPropagation();openLightbox(list,index());};
    item.addEventListener('dragstart',()=>{dragIndex=index();});
    item.addEventListener('dragover',e=>e.preventDefault());
    item.addEventListener('drop',e=>{e.preventDefault();moveItem(list,dragIndex,index());render();});
    qsa('button[data-action]',item).forEach(btn=>btn.onclick=()=>{
      const i=index(),action=btn.dataset.action;
      if(action==='left') moveItem(list,i,i-1);
      if(action==='right') moveItem(list,i,i+1);
      if(action==='primary') moveItem(list,i,0);
      if(action==='delete') list.splice(i,1);
      render();
    });
  });
}
function renderPhotos(){
  $('photoPreview').innerHTML=currentPhotos.map((p,i)=>photoMarkup(p,i,'record')).join('');
  bindPhotoGrid($('photoPreview'),currentPhotos,renderPhotos);
}
function renderLifecyclePhotos(){
  $('stagePhotoPreview').innerHTML=lifecyclePhotos.map((p,i)=>photoMarkup(p,i,'lifecycle')).join('');
  bindPhotoGrid($('stagePhotoPreview'),lifecyclePhotos,renderLifecyclePhotos);
}

function openLightbox(list,index){
  lightboxPhotos=list; lightboxIndex=index; lightboxScale=1;
  $('photoLightbox').classList.remove('hidden');
  updateLightbox();
}
function updateLightbox(){
  if(!lightboxPhotos.length){ closeLightbox(); return; }
  lightboxIndex=(lightboxIndex+lightboxPhotos.length)%lightboxPhotos.length;
  $('lightboxImage').src=lightboxPhotos[lightboxIndex].data;
  $('lightboxImage').style.transform=`scale(${lightboxScale})`;
  $('lightboxCounter').textContent=`${lightboxIndex+1} of ${lightboxPhotos.length}`;
}
function closeLightbox(){ $('photoLightbox').classList.add('hidden'); $('lightboxImage').removeAttribute('src'); }
function changeLightbox(delta){ lightboxScale=1; lightboxIndex+=delta; updateLightbox(); }
function zoomLightbox(delta){ lightboxScale=Math.max(.5,Math.min(5,lightboxScale+delta));$('lightboxImage').style.transform=`scale(${lightboxScale})`; }

function openLifecycleEditor(entry=null){
  $('lifecycleEditor').classList.remove('hidden');
  $('lifecycleId').value=entry?.id || '';
  LIFECYCLE_FIELDS.forEach(field=>setValue(field,entry?.[field] || ''));
  if(!entry){ setValue('lifecycleDate',today());setValue('lifecycleTime',timeNow()); }
  lifecyclePhotos=normalizePhotos(structuredClone(entry?.photos || []));
  renderLifecyclePhotos();
  $('deleteLifecycleBtn').classList.toggle('hidden',!entry);
}
function closeLifecycleEditor(){ $('lifecycleEditor').classList.add('hidden'); }
function lifecycleFromForm(){
  const entry={id:$('lifecycleId').value || uid(),photos:structuredClone(lifecyclePhotos)};
  LIFECYCLE_FIELDS.forEach(field=>entry[field]=getValue(field));
  return entry;
}
function saveLifecycle(){
  const entry=lifecycleFromForm();
  const idx=lifecycleEntries.findIndex(x=>x.id===entry.id);
  if(idx>=0) lifecycleEntries[idx]=entry; else lifecycleEntries.push(entry);
  lifecycleEntries.sort((a,b)=>`${a.lifecycleDate} ${a.lifecycleTime}`.localeCompare(`${b.lifecycleDate} ${b.lifecycleTime}`));
  renderLifecycleList(); closeLifecycleEditor(); toast('Lifecycle observation saved');
}
function deleteLifecycle(){
  const id=$('lifecycleId').value;
  if(!id||!confirm('Delete this lifecycle observation?')) return;
  lifecycleEntries=lifecycleEntries.filter(x=>x.id!==id);
  renderLifecycleList(); closeLifecycleEditor();
}
function renderLifecycleList(){
  if(!lifecycleEntries.length){ $('lifecycleList').className='lifecycle-list full empty-state';$('lifecycleList').textContent='No lifecycle observations yet.';return; }
  $('lifecycleList').className='lifecycle-list full';
  $('lifecycleList').innerHTML=lifecycleEntries.map(entry=>{
    const photo=normalizePhoto(entry.photos?.[0]);
    return `<article class="lifecycle-card" data-id="${entry.id}">
      ${photo?`<img src="${photo.data}" alt="">`:'<div class="lifecycle-placeholder"></div>'}
      <div><h4>${esc(entry.lifecycleStage || 'Observation')}</h4><p>${esc(entry.lifecycleDate || '')} ${esc(entry.lifecycleTime || '')}</p><p>${esc(entry.lifecycleNotes || '')}</p></div>
      <button type="button" data-edit-lifecycle="${entry.id}">Edit</button>
    </article>`;
  }).join('');
  qsa('[data-edit-lifecycle]').forEach(btn=>btn.onclick=()=>openLifecycleEditor(lifecycleEntries.find(x=>x.id===btn.dataset.editLifecycle)));
}

function statusLabel(status){ return ({field:'Field record',pressing:'Pressing / drying',identified:'Identified',mounted:'Mounted'})[status] || status || ''; }
function primaryPhoto(record){
  return normalizePhoto(record.photos?.[0])?.data ||
    normalizePhoto(record.lifecycleObservations?.at(-1)?.photos?.[0])?.data || '';
}
function recordCard(record){
  const photo=primaryPhoto(record);
  return `<article class="record-card" data-record-id="${record.id}">
    ${photo?`<img class="record-thumb" src="${photo}" alt="">`:'<div class="record-placeholder"></div>'}
    <div><h3>${esc(record.commonName || record.scientificName || 'Unidentified plant')}</h3>
      <p><span class="status-pill">${esc(statusLabel(record.status))}</span> ${esc(record.collectionNumber || '')}</p>
      <p>${esc(record.date || '')} · ${esc(record.genus || record.family || '')} · ${esc(record.habitat || '')}</p>
    </div>
    <div>${validCoordinates(record.latitude,record.longitude)?`<a class="button-link secondary" href="${mapUrls(record.latitude,record.longitude).google}" target="_blank" rel="noopener" onclick="event.stopPropagation()">Map</a>`:''}</div>
  </article>`;
}
async function renderDashboard(){
  const rows=await allRecords();
  $('statRecords').textContent=rows.length;
  $('statIdentified').textContent=rows.filter(r=>['identified','mounted'].includes(r.status)).length;
  $('statMounted').textContent=rows.filter(r=>r.status==='mounted').length;
  $('statLifecycle').textContent=rows.reduce((n,r)=>n+(r.lifecycleObservations?.length||0),0);
  const recent=[...rows].sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).slice(0,6);
  $('recentRecords').className=recent.length?'record-list':'record-list empty-state';
  $('recentRecords').innerHTML=recent.length?recent.map(recordCard).join(''):'No records yet.';
  bindRecordCards($('recentRecords'));
}
function bindRecordCards(container){
  qsa('.record-card',container).forEach(card=>card.onclick=()=>editRecord(card.dataset.recordId));
}

function filteredRecords(rows){
  const q=$('searchInput').value.toLowerCase().trim();
  const status=$('statusFilter').value;
  const date=$('dateFilter').value;
  return rows.filter(r=>{
    const hay=JSON.stringify(r).toLowerCase();
    return (!q||hay.includes(q))&&(!status||r.status===status)&&(!date||r.date===date);
  });
}
function displayValue(r,key){
  if(key==='status') return statusLabel(r.status);
  if(key==='weatherConditions') return (r.weatherConditions||[]).join('; ');
  if(key==='updatedAt') return r.updatedAt ? new Date(r.updatedAt).toLocaleString() : '';
  if(key==='map') return validCoordinates(r.latitude,r.longitude)?'View map':'';
  return r[key] || '';
}
function compareRecord(a,b,key){
  return String(displayValue(a,key)).localeCompare(String(displayValue(b,key)),undefined,{numeric:true,sensitivity:'base'});
}
function renderColumnOptions(){
  $('columnOptions').innerHTML=TABLE_COLUMNS.map(([key,label])=>`<label><input type="checkbox" value="${key}" ${visibleColumns.includes(key)?'checked':''}> ${esc(label)}</label>`).join('');
  qsa('#columnOptions input').forEach(box=>box.onchange=()=>{
    const checked=qsa('#columnOptions input:checked').map(x=>x.value);
    if(!checked.length){box.checked=true;toast('Keep at least one column');return;}
    visibleColumns=checked;localStorage.setItem('visibleColumnsV3',JSON.stringify(visibleColumns));renderRecords();
  });
}
function renderTable(rows){
  const cols=TABLE_COLUMNS.filter(c=>visibleColumns.includes(c[0]));
  const sorted=[...rows].sort((a,b)=>{const v=compareRecord(a,b,tableSort.key);return tableSort.direction==='asc'?v:-v;});
  $('recordsList').className='records-table-wrap';
  $('recordsList').innerHTML=`<table class="records-table"><thead><tr>${cols.map(([key,label])=>`<th><button class="sort-heading" data-sort="${key}">${esc(label)}${tableSort.key===key?(tableSort.direction==='asc'?' ▲':' ▼'):''}</button></th>`).join('')}</tr></thead>
  <tbody>${sorted.map(r=>`<tr data-record-id="${r.id}">${cols.map(([key])=>{
    if(key==='map') return `<td>${validCoordinates(r.latitude,r.longitude)?`<a href="${mapUrls(r.latitude,r.longitude).google}" target="_blank" rel="noopener" onclick="event.stopPropagation()">View map</a>`:''}</td>`;
    const val=displayValue(r,key); return `<td>${key==='scientificName'?`<i>${esc(val)}</i>`:esc(val)}</td>`;
  }).join('')}</tr>`).join('')}</tbody></table>`;
  qsa('.sort-heading').forEach(btn=>btn.onclick=e=>{e.stopPropagation();const key=btn.dataset.sort;tableSort={key,direction:tableSort.key===key&&tableSort.direction==='asc'?'desc':'asc'};localStorage.setItem('tableSortV3',JSON.stringify(tableSort));renderRecords();});
  qsa('.records-table tbody tr').forEach(row=>row.onclick=()=>editRecord(row.dataset.recordId));
}
function renderKanban(rows){
  const groups=[['field','Field records'],['pressing','Pressing / drying'],['identified','Identified'],['mounted','Mounted']];
  $('recordsList').className='kanban-board';
  $('recordsList').innerHTML=groups.map(([key,label])=>`<section class="kanban-column"><header><h3>${label}</h3><span>${rows.filter(r=>r.status===key).length}</span></header>
    <div class="kanban-cards">${rows.filter(r=>r.status===key).map(r=>{const photo=primaryPhoto(r);return `<article class="kanban-card" data-record-id="${r.id}">
      ${photo?`<img src="${photo}" alt="">`:'<div class="kanban-no-photo">No photograph</div>'}
      <div class="kanban-caption"><strong>${esc(r.commonName||r.scientificName||'Unidentified plant')}</strong><small>${esc(r.collectionNumber||'')}</small><span>${esc(r.genus||r.family||'')}</span></div>
    </article>`;}).join('')||'<p class="muted">No records</p>'}</div></section>`).join('');
  qsa('.kanban-card').forEach(card=>card.onclick=()=>editRecord(card.dataset.recordId));
}
async function renderRecords(){
  const rows=filteredRecords(await allRecords());
  qsa('.view-mode').forEach(b=>b.classList.toggle('active',b.dataset.recordView===recordViewMode));
  $('columnChooser').classList.toggle('hidden',recordViewMode!=='table');
  if(!rows.length){$('recordsList').className='record-list empty-state';$('recordsList').textContent='No matching records.';return;}
  if(recordViewMode==='table') return renderTable(rows);
  if(recordViewMode==='kanban') return renderKanban(rows);
  $('recordsList').className='record-list';
  $('recordsList').innerHTML=rows.sort((a,b)=>(b.updatedAt||'').localeCompare(a.updatedAt||'')).map(recordCard).join('');
  bindRecordCards($('recordsList'));
}

function download(name,text,type='application/json'){
  const blob=new Blob([text],{type});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function buildMasterFile(){
  const data={version:3,appVersion:APP_VERSION,exportedAt:nowIso(),settings:settings(),records:await allRecords()};
  const jsonText=JSON.stringify(data);
  return {
    jsonText,
    file:new File([jsonText],MASTER_FILENAME,{type:'text/plain'})
  };
}
async function downloadMasterFile(){
  const {jsonText}=await buildMasterFile();
  download(MASTER_FILENAME,jsonText);
  const meta=syncMeta();
  meta.lastExport=nowIso();
  saveSyncMeta(meta);
  toast(`Downloaded ${MASTER_FILENAME}`);
}
async function shareMasterFile(){
  const {file}=await buildMasterFile();
  try{
    if(!navigator.share || !navigator.canShare || !navigator.canShare({files:[file]})){
      await downloadMasterFile();
      toast('File sharing is unavailable; the master file was downloaded instead.');
      return;
    }
    await navigator.share({
      title:'Prairie Herbarium master database',
      text:'Save or replace this file in Google Drive.',
      files:[file]
    });
    const meta=syncMeta();
    meta.lastExport=nowIso();
    saveSyncMeta(meta);
    toast('Master file sent to the share menu');
  }catch(error){
    if(error.name==='AbortError') return;
    console.warn('Share failed; downloading instead:',error);
    await downloadMasterFile();
    alert('Direct sharing was denied by the browser. The master file has been downloaded instead. Open Downloads and upload it to Google Drive.');
  }
}
async function restoreJSON(file){
  const status=$('restoreStatus');
  try{
    status.textContent=`Reading ${file.name}…`;
    const data=JSON.parse(await file.text());
    const records=Array.isArray(data)?data:data.records;
    if(!Array.isArray(records)) throw new Error('No records array was found in this file.');

    const existing=new Map((await allRecords()).map(r=>[r.id,r]));
    let added=0,updated=0,unchanged=0;

    for(const raw of records){
      const incoming=normalizeRecord(raw);
      const current=existing.get(incoming.id);
      if(!current){
        await putRecord(incoming);
        added++;
      }else{
        const incomingTime=new Date(incoming.updatedAt||incoming.createdAt||0).getTime();
        const currentTime=new Date(current.updatedAt||current.createdAt||0).getTime();
        if(incomingTime>currentTime){
          await putRecord(incoming);
          updated++;
        }else{
          unchanged++;
        }
      }
      status.textContent=`Comparing ${added+updated+unchanged} of ${records.length} records…`;
    }

    if(data.settings) saveSettings({...settings(),...data.settings});
    loadSettings();

    const message=`Import complete: ${added} added, ${updated} updated, ${unchanged} unchanged`;
    status.textContent=message;
    toast(message);

    const meta=syncMeta();
    meta.lastImport=nowIso();
    saveSyncMeta(meta);

    await renderDashboard();
    await renderRecords();
    await renderSyncStatus();
  }catch(error){
    console.error(error);
    status.textContent=`Import failed: ${error.message}`;
    alert(`Import failed:\n\n${error.message}`);
  }finally{
    $('restoreInput').value='';
  }
}
async function exportCSV(){
  const rows=await allRecords();
  const headers=['collectionNumber','date','time','commonName','scientificName','genus','family','status','locationDescription','latitude','longitude','habitat','season','weatherConditions','growthForm','height','flowerColor','phenology','fieldNotes','pressDate','pressTime','paperChangeDate','paperChangeTime','dryDate','mountedDate','updatedAt'];
  const csv=[headers.join(',')].concat(rows.map(r=>headers.map(h=>{
    const val=h==='weatherConditions'?(r[h]||[]).join('; '):(r[h]||'');
    return `"${String(val).replace(/"/g,'""')}"`;
  }).join(','))).join('\n');
  download(`herbarium-${today()}.csv`,csv,'text/csv');
}
function printFieldCards(){
  const cards=Array.from({length:3},()=>`<section class="field-card"><h2>Plant Collection Field Record</h2><p><b>Collection #:</b> ____________________</p><p><b>Date:</b> __________ <b>Time:</b> ________</p><p><b>Location:</b><br><br></p><p><b>GPS:</b> ______________________________</p><p><b>Habitat:</b> ___________________________</p><p><b>Season:</b> □ Spring □ Summer □ Fall □ Winter</p><p><b>Weather:</b> □ Clear □ Cloudy □ Rain □ Wind<br>□ Hot □ Mild □ Cool □ Cold</p><p><b>Plant / notes:</b><br><br><br><br></p><p><b>Photos:</b> □ Whole □ Flower □ Leaves □ Stem □ Habitat □ Fruit</p></section>`).join('');
  const w=window.open('','_blank');
  w.document.write(`<html><head><title>Field cards</title><style>@page{size:letter landscape;margin:.35in}body{display:grid;grid-template-columns:repeat(3,1fr);gap:.2in;font:11px Arial}.field-card{border:1px solid #333;padding:.18in}h2{font-size:15px}</style></head><body>${cards}</body></html>`);
  w.document.close();w.print();
}

function loadSettings(){
  const s=settings();
  $('settingCollector').value=s.collector||'';
  $('settingPrefix').value=s.prefix||'DR';
  $('settingLocality').value=s.locality||'';
  $('settingSequence').value=s.sequence||1;
}
function saveSettingsForm(e){
  e.preventDefault();
  saveSettings({
    collector:$('settingCollector').value.trim(),
    prefix:$('settingPrefix').value.trim().toUpperCase()||'DR',
    locality:$('settingLocality').value.trim(),
    sequence:Number($('settingSequence').value)||1
  });
  toast('Settings saved');
}

function bindEvents(){
  qsa('.nav-btn').forEach(btn=>btn.onclick=()=>setView(btn.dataset.view));
  $('newRecordBtn').onclick=()=>{resetRecordForm();setView('record');};
  $('recordForm').onsubmit=saveRecord;
  $('duplicateRecordBtn').onclick=duplicateRecord;
  $('deleteRecordBtn').onclick=removeCurrentRecord;
  $('gpsBtn').onclick=captureGPS;
  ['latitude','longitude'].forEach(id=>$(id).addEventListener('input',updateMapPreview));
  $('date').onchange=()=>{if(!$('season').value)$('season').value=seasonForDate($('date').value);};
  $('scientificName').onblur=()=>{if(!$('genus').value.trim())$('genus').value=$('scientificName').value.trim().split(/\s+/)[0]||'';};
  $('pressDate').onchange=()=>updatePaperChange(true);
  $('pressTime').onchange=()=>updatePaperChange(true);
  $('calendarReminderBtn').onclick=openCalendarReminder;

  $('choosePhotoBtn').onclick=()=>$('photoInput').click();
  $('takePhotoBtn').onclick=()=>$('photoCameraInput').click();
  $('photoInput').onchange=e=>{addPhotoFiles(e.target.files,currentPhotos,renderPhotos);e.target.value='';};
  $('photoCameraInput').onchange=e=>{addPhotoFiles(e.target.files,currentPhotos,renderPhotos);e.target.value='';};
  bindDropZone('photoDropZone',currentPhotos,renderPhotos);

  $('addLifecycleBtn').onclick=()=>openLifecycleEditor();
  $('closeLifecycleBtn').onclick=closeLifecycleEditor;
  $('saveLifecycleBtn').onclick=saveLifecycle;
  $('deleteLifecycleBtn').onclick=deleteLifecycle;
  $('chooseStagePhotoBtn').onclick=()=>$('stagePhotoInput').click();
  $('takeStagePhotoBtn').onclick=()=>$('stagePhotoCameraInput').click();
  $('stagePhotoInput').onchange=e=>{addPhotoFiles(e.target.files,lifecyclePhotos,renderLifecyclePhotos);e.target.value='';};
  $('stagePhotoCameraInput').onchange=e=>{addPhotoFiles(e.target.files,lifecyclePhotos,renderLifecyclePhotos);e.target.value='';};
  bindDropZone('stagePhotoDropZone',lifecyclePhotos,renderLifecyclePhotos);

  $('shareMasterBtn').onclick=shareMasterFile;
  $('downloadMasterBtn').onclick=downloadMasterFile;
  $('importMasterBtn').onclick=()=>$('restoreInput').click();
  $('restoreInput').onchange=e=>e.target.files?.[0]&&restoreJSON(e.target.files[0]);
  $('exportCsvBtn').onclick=exportCSV;
  $('printFieldCardsBtn').onclick=printFieldCards;
  $('searchInput').oninput=renderRecords;
  $('statusFilter').onchange=renderRecords;
  $('dateFilter').onchange=renderRecords;
  qsa('.view-mode').forEach(btn=>btn.onclick=()=>{recordViewMode=btn.dataset.recordView;localStorage.setItem('recordViewModeV3',recordViewMode);renderRecords();});
  $('settingsForm').onsubmit=saveSettingsForm;

  $('lightboxClose').onclick=closeLightbox;
  $('lightboxPrev').onclick=()=>changeLightbox(-1);
  $('lightboxNext').onclick=()=>changeLightbox(1);
  $('lightboxZoomIn').onclick=()=>zoomLightbox(.25);
  $('lightboxZoomOut').onclick=()=>zoomLightbox(-.25);
  $('lightboxReset').onclick=()=>{lightboxScale=1;updateLightbox();};
  document.addEventListener('keydown',e=>{
    if($('photoLightbox').classList.contains('hidden')) return;
    if(e.key==='Escape')closeLightbox();
    if(e.key==='ArrowLeft')changeLightbox(-1);
    if(e.key==='ArrowRight')changeLightbox(1);
  });
}

async function init(){
  $('appVersion').textContent=APP_VERSION;
  $('settingsVersion').textContent=APP_VERSION;
  await openDB();
  loadSettings();
  renderColumnOptions();
  bindEvents();
  resetRecordForm();
  await renderDashboard();
  await renderSyncStatus();
  if('serviceWorker' in navigator){
    navigator.serviceWorker.register('service-worker.js').catch(console.error);
  }
}

init().catch(error=>{
  console.error(error);
  $('restoreStatus').textContent=`Startup failed: ${error.message}`;
  $('appVersion').textContent=`${APP_VERSION} — ERROR`;
  alert(`Prairie Herbarium could not start:\n\n${error.message}`);
});
})();