// Synthetic variants of the Step 5 rectangle; no personal media.
import {readFileSync,writeFileSync} from 'node:fs';
const base=readFileSync(new URL('../media/capture-gps.jpg',import.meta.url));
for(const [name,date,gps] of [['morning-a.jpg','2001:02:03 09:12:00',true],['morning-b.jpg','2001:02:03 09:30:00',true],['timestamp-only.jpg','2001:02:03 10:00:00',false],['later.jpg','2001:02:06 11:00:00',true]]){
 const b=Buffer.from(base);b.write(date,b.indexOf('2001:02:03 04:05:06'),'ascii');
 if(!gps)b.writeUInt16LE(0xc4a5,b.indexOf('Exif')+6+8+2+24); // Replace GPS IFD tag with an unrecognized private tag.
 writeFileSync(new URL(name,import.meta.url),b);
}
writeFileSync(new URL('unknown.jpg',import.meta.url),readFileSync(new URL('../media/plain.jpg',import.meta.url)));
