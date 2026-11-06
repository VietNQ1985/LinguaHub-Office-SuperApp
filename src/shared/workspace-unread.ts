// Only consume the website's numeric title badge, never conversation text.
export type UnreadValue=number|'dot'
export type UnreadCounts={whatsapp:UnreadValue;teams:UnreadValue;zalo:UnreadValue}
export function unreadFromTitle(title:string):number{
 const match=title.match(/^\s*[([]\s*(\d{1,6})(\+)?\s*[)\]]/)
 return match?Math.min(999999,Number(match[1])):0
}
export function unreadLabel(count:number){return count>99?'99+':String(count)}
