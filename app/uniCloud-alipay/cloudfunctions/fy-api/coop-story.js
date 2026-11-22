const { seatOf } = require('./partnership-service')

const finale = {
  act: 7, title: '双城终章 · 一念归期', start: 'museum',
  scenes: [
    { id: 'museum', kind: 'dialogue', speaker: '澳喵', asset: 'aomiao', nextSceneId: 'macau',
      text: '再看展柜前那条金色航线。澳门和湖南仍隔着很远，这次你们可以把两地记下的细节放在一起。' },
    { id: 'macau', kind: 'dialogue', speaker: '澳门旅伴', asset: 'tile-workshop', nextSceneId: 'hunan',
      text: '我记得蓝白瓷砖上船帆的弧线。配色时留出一点空白，那条线就像还在海面上走。' },
    { id: 'hunan', kind: 'dialogue', speaker: '湖南旅伴', asset: 'embroidery-room', nextSceneId: 'together',
      text: '我记得绣线转折的地方。换一个角度，绣面的光也跟着变了。我想把这一笔放在你的船帆旁边。' },
    { id: 'together', kind: 'ending', asset: 'aomiao',
      text: '你们把瓷砖纹样和湘绣针法放进同一幅纪念画。下次再看见那条航线，你会想起旅伴从另一座城带来的故事。' }
  ]
}

async function coopChapters(db, run, runId, key) {
  const own = run.snapshot.culture?.chapters ?? []
  const local = { chapters: own, full: false }
  if (run.teamId == null) return local
  const team = await db.get('fy-teams', run.teamId)
  if (team?.members?.length !== 2 || !team.members.includes(run.uid) || team.runs?.[run.uid] !== runId) return local
  const other = team.members.find(uid => uid !== run.uid)
  const crossRegion = seatOf(team, run.uid) !== seatOf(team, other)
  if (team.status !== 'done' || !crossRegion) {
    return { ...local, pending: crossRegion && team.status === 'active' }
  }
  const partnerRunId = team.runs[other]
  if (typeof partnerRunId !== 'string') return local
  const result = await db.get('fy-results', key(run.teamId, 'result'))
  if (result?.teamId !== run.teamId) return local
  const partnerRun = await db.get('fy-runs', partnerRunId)
  if (partnerRun?.uid !== other || partnerRun?.teamId !== run.teamId || partnerRun?.purpose !== 'coop') return local
  // Keep the member's original chapters when both snapshots contain the same act.
  const combined = new Map([...(partnerRun.snapshot.culture?.chapters ?? []), ...own].map(chapter => [chapter.act, chapter]))
  const mainStory = [2, 3, 4, 5, 6].map(act => combined.get(act))
  if (mainStory.some(chapter => !chapter)) return local
  return { chapters: [...mainStory, finale], full: true }
}

module.exports = { coopChapters }
