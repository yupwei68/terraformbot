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
  app.on('create_tag', async context => {
    const payload = context.payload
    const owner = payload.repository.owner.login
    const repo = payload.repository.name
    const tag_name = payload.ref
    const tag = await context.github.repos.getReleaseByTag({owner, repo, tag_name})

    if(tag !== null) {// If tag exists, return
      return
    }

    const tags = await context.repos.getTags({owner, repo}) 
    if(tags.length < 2){
      return
    }
    const head = tags[0].name
    const base = tags[1].name

    const commitsLog = await context.repos.compareCommits( {owner, repo, base, head})
    
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
  })


  // For more information on building apps:
  // https://probot.github.io/docs/

  // To get your app running against GitHub, see:
  // https://probot.github.io/docs/development/
}
