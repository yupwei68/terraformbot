/**
 * This is the entry point for your Probot App.
 * @param {import('probot').Application} app - Probot's Application class.
 */

module.exports = app => {
  // Your code here
  app.log('Yay, the app was loaded!')

  app.on('issues.opened', async context => {
    const issueComment = context.issue({ body: 'Thanks for opening this issue!' })
    return context.github.issues.createComment(issueComment)
  })

  app.on('issues.opened', async context => {
    const config = await context.config('labeler.yml',{numLabels: 20})
    const labels = await context.github.issues.getLabels(context.issue({per_page:config.numLabels}))
    const issue = await context.github.issues.get(context.issue())

    let labelList = []
    let labelsToAdd = []

    labels.data.map(label => labelList.push(label.name))
    labelList.filter(label=>!config.excludeLabels.includes(label)).map(label=>
      issue.data.title.toLowerCase().includes(label) || issue.data.body.toLowerCase().includes(label) ? labelsToAdd.push(label) : null)
    
    return context.github.issues.addLabels(context.issue({labels: labelsToAdd }))
  })

  app.on('issues.labeled',async context => {
    const config = await context.config('autoAssignees.yml')
    const payload = context.payload

    const owner = payload.repository.owner.login
    const repo = payload.repository.name
    const issueNumber = payload.issue.number
   
    const assignMap = config.labelToAuthor
    const assignees = assignMap[payload.label.name]
    if (assignees) {
      const result = await context.github.issues.addAssigneesToIssue({
        owner,
        repo,
        number: issueNumber,
        assignees
      })
  
      return result
    }
  })
  const RELEASE_CHANGE_MAP = {
    document: 'docs',
    feature: 'feat',
    bugfix: 'fix',
    close: 'close'
  }
  app.on('create', async context => {
    const payload = context.payload
    if((payload.action ||payload.ref_type) != 'tag')
      return
      
    const owner = payload.repository.owner.login
    const repo = payload.repository.name
    const tag_name = payload.ref
    const tag = await getReleaseByTag(payload, {
      tag_name: payload.ref
    })

    if(tag !== null) {// If tag exists, return
      return
    }

    const tags = await getTags(payload)
    if(tags.length < 2){
      return
    }
    const head = tags[0].name
    const base = tags[1].name

    const commitsLog = await compareCommits(payload, {
      base,
      head
    })
    
    const commits = commitsLog.commits
    const changes = Object.keys(RELEASE_CHANGE_MAP).map(title => {
      return {
        title,
        data: commits
          .filter((commit) => commit.commit.message.indexOf(`${RELEASE_CHANGE_MAP[title]}:`) === 0)
          .map((commit) => {
            let message = commit.commit.message
            // 处理 squash merge 的 commit message
            if (message.indexOf('\n') !== -1) {
              message = message.substr(0, message.indexOf('\n'))
            }
            return `- ${message}, by @${commit.author.login} <<${commit.commit.author.email}>>`
          })
      }
    }).filter(v => v.data.length)

    const hashChanges = commits.map((commit) => {
      let message = commit.commit.message
      // 处理 squash merge 的 commit message
      if (message.indexOf('\n') !== -1) {
        message = message.substr(0, message.indexOf('\n'))
      }
      return `- [${commit.sha.substr(0, 7)}](${commit.html_url}) - ${message}, by @${commit.author.login} <<${commit.commit.author.email}>>`
    })

    let body = []

    if (changes.length) {
      body.push('## Notable changes\n')
      changes.forEach(v => {
        body.push(`- ${v.title}`)

        v.data.forEach(line => body.push('     ' + line))
      })
    }

    if (hashChanges.length) {
      body.push('\n## Commits\n')
      body = body.concat(hashChanges)
    }

    if (body.length) {
      createRelease(payload, {
        tag_name: payload.ref,
        name: `${payload.ref} @${payload.repository.owner.login}`,
        body: body.join('\n')
      })
    }

      /**
     * 根据tag获取发布信息
     *
     * @param  {Object} payload          data
     * @param  {string} options.tag_name tag名
     *
     * @return {Object | null}
     */
    async function getReleaseByTag (payload, { tag_name } = {}) {
      const owner = payload.repository.owner.login
      const repo = payload.repository.name
      try {
        const res = await context.github.repos.getReleaseByTag({
          owner,
          repo,
          tag: tag_name
        })
        return res.data
      } catch (e) {
        //app.log.error(new Error(e))
        return null
      }
    }
      /**
     * 获得 repo 所有的tag
     *
     * @param {any} payload             data
     * @return {Array}
     */
    async function getTags (payload) {
      const owner = payload.repository.owner.login
      const repo = payload.repository.name
      try {
        const res = await context.github.repos.getTags({
          owner,
          repo
        })
        return res.data
      } catch (e) {
        app.log.error(new Error(e))
        return []
      }
    }
    /**
     * 对比2个提交
     *
     * @param  {Object} payload      data
     * @param  {string} options.base 基点
     * @param  {string} options.head diff
     * @return {Array | null}
     */
    async function compareCommits (payload, { base, head } = {}) {
      const owner = payload.repository.owner.login
      const repo = payload.repository.name
      try {
        const res = await context.github.repos.compareCommits({
          owner,
          repo,
          base,
          head
        })
        return res.data
      } catch (e) {
        app.log.error(new Error(e))
        return null
      }
    }
    /**
     * 创建发布
     *
     * @param  {Object} payload                  data
     * @param  {string} options.tag_name         tag名
     * @param  {string} options.target_commitish tag hash
     * @param  {string} options.name             标题
     * @param  {string} options.body             内容
     * @param  {boolean} options.draft            是否为草稿
     * @param  {boolean} options.prerelease       是否预发布
     * @return {boolean} 是否成功
     */
    async function createRelease (payload, { tag_name, target_commitish, name, body, draft, prerelease } = {}) {
      const owner = payload.repository.owner.login
      const repo = payload.repository.name
      try {
        await github.repos.createRelease({
          owner,
          repo,
          tag_name,
          target_commitish,
          name,
          body,
          draft,
          prerelease
        })
        return true
      } catch (e) {
        app.log.error(new Error(e))
        return false
      }
    }

  })
  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
}
