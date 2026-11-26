/** 自动生成：node scripts/generate-tool-output-schemas.mjs。源为实际handler/领域返回类型；不要手工修改。 */
export const generatedToolOutputs: { results: Record<string, Record<string, unknown>>; definitions: Record<string, Record<string, unknown>>; sources: Record<string,string> } = {
  "results": {
    "activity.project": {
      "$ref": "#/$defs/T412"
    },
    "announcement.list": {
      "$ref": "#/$defs/T146"
    },
    "announcement.revoke": {
      "$ref": "#/$defs/T486"
    },
    "announcement.send": {
      "$ref": "#/$defs/T484"
    },
    "approval.approve": {
      "$ref": "#/$defs/T489"
    },
    "approval.list": {
      "$ref": "#/$defs/T430"
    },
    "approval.reject": {
      "$ref": "#/$defs/T489"
    },
    "attachment.download": {
      "$ref": "#/$defs/T140"
    },
    "attachment.get": {
      "$ref": "#/$defs/T141"
    },
    "attachment.remove": {
      "$ref": "#/$defs/T134"
    },
    "automation.createRule": {
      "$ref": "#/$defs/T492"
    },
    "automation.deleteRule": {
      "$ref": "#/$defs/T143"
    },
    "automation.listRules": {
      "$ref": "#/$defs/T432"
    },
    "automation.listRuns": {
      "$ref": "#/$defs/T434"
    },
    "automation.testRule": {
      "$ref": "#/$defs/T144"
    },
    "automation.updateRule": {
      "$ref": "#/$defs/T142"
    },
    "collab.command": {
      "$ref": "#/$defs/T459"
    },
    "collab.inspect": {
      "$ref": "#/$defs/T381"
    },
    "collab.publishPage": {
      "$ref": "#/$defs/T461"
    },
    "collab.update": {
      "$ref": "#/$defs/T460"
    },
    "comment.create": {
      "$ref": "#/$defs/T19"
    },
    "comment.delete": {
      "$ref": "#/$defs/T472"
    },
    "comment.list": {
      "$ref": "#/$defs/T17"
    },
    "comment.update": {
      "$ref": "#/$defs/T471"
    },
    "customField.archive": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T188"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "customField.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T244"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "customField.definitions": {
      "$ref": "#/$defs/T242"
    },
    "customField.getValues": {
      "$ref": "#/$defs/T20"
    },
    "customField.setValues": {
      "$ref": "#/$defs/T22"
    },
    "customField.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T245"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "dashboard.addWidget": {
      "$ref": "#/$defs/T211"
    },
    "dashboard.create": {
      "$ref": "#/$defs/T208"
    },
    "dashboard.delete": {
      "$ref": "#/$defs/T455"
    },
    "dashboard.deleteWidget": {
      "$ref": "#/$defs/T457"
    },
    "dashboard.get": {
      "$ref": "#/$defs/T206"
    },
    "dashboard.list": {
      "$ref": "#/$defs/T454"
    },
    "dashboard.listWidgets": {
      "$ref": "#/$defs/T456"
    },
    "dashboard.update": {
      "$ref": "#/$defs/T209"
    },
    "dashboard.updateWidget": {
      "$ref": "#/$defs/T212"
    },
    "dashboard.widgetData": {
      "$ref": "#/$defs/T458"
    },
    "dashboard.widgets.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T211"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "dashboard.widgets.data": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "$ref": "#/$defs/T193"
        },
        {
          "$ref": "#/$defs/T196"
        },
        {
          "$ref": "#/$defs/T213"
        },
        {
          "$ref": "#/$defs/T214"
        },
        {
          "$ref": "#/$defs/T216"
        },
        {
          "$ref": "#/$defs/T219"
        },
        {
          "$ref": "#/$defs/T222"
        }
      ]
    },
    "dashboard.widgets.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T188"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "dashboard.widgets.list": {
      "$ref": "#/$defs/T210"
    },
    "dashboard.widgets.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T212"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "delivery.configureSource": {
      "$ref": "#/$defs/T57"
    },
    "delivery.createCandidate": {
      "$ref": "#/$defs/T343"
    },
    "delivery.createEvidence": {
      "$ref": "#/$defs/T59"
    },
    "delivery.getEvidence": {
      "$ref": "#/$defs/T59"
    },
    "delivery.linkEvidence": {
      "$ref": "#/$defs/T59"
    },
    "delivery.listEvidence": {
      "$ref": "#/$defs/T58"
    },
    "delivery.recordFeedback": {
      "$ref": "#/$defs/T347"
    },
    "delivery.releaseGate": {
      "$ref": "#/$defs/T342"
    },
    "delivery.sources": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T57"
      }
    },
    "department.archive": {
      "$ref": "#/$defs/T293"
    },
    "department.create": {
      "$ref": "#/$defs/T99"
    },
    "department.list": {
      "$ref": "#/$defs/T97"
    },
    "department.update": {
      "$ref": "#/$defs/T100"
    },
    "export.projectReport": {
      "$ref": "#/$defs/T56"
    },
    "export.workItems": {
      "$ref": "#/$defs/T55"
    },
    "focus.blocks": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T177"
      }
    },
    "focus.createBlock": {
      "$ref": "#/$defs/T179"
    },
    "focus.deleteBlock": {
      "$ref": "#/$defs/T447"
    },
    "focus.getBlock": {
      "$ref": "#/$defs/T177"
    },
    "focus.getSession": {
      "$ref": "#/$defs/T178"
    },
    "focus.listBlocks": {
      "$ref": "#/$defs/T446"
    },
    "focus.listSessions": {
      "$ref": "#/$defs/T448"
    },
    "focus.recordSession": {
      "$ref": "#/$defs/T181"
    },
    "focus.sessions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T178"
      }
    },
    "focus.today": {
      "$ref": "#/$defs/T183"
    },
    "focus.updateBlock": {
      "$ref": "#/$defs/T180"
    },
    "focus.updateSession": {
      "$ref": "#/$defs/T182"
    },
    "idea.delete": {
      "$ref": "#/$defs/T134"
    },
    "idea.get": {
      "$ref": "#/$defs/T131"
    },
    "idea.list": {
      "$ref": "#/$defs/T129"
    },
    "idea.promote": {
      "$ref": "#/$defs/T475"
    },
    "idea.submit": {
      "$ref": "#/$defs/T473"
    },
    "idea.unvote": {
      "$ref": "#/$defs/T134"
    },
    "idea.update": {
      "$ref": "#/$defs/T133"
    },
    "idea.vote": {
      "$ref": "#/$defs/T474"
    },
    "import.confirm": {
      "$ref": "#/$defs/T166"
    },
    "import.create": {
      "$ref": "#/$defs/T159"
    },
    "import.dryRun": {
      "$ref": "#/$defs/T164"
    },
    "import.get": {
      "$ref": "#/$defs/T161"
    },
    "import.list": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T160"
      }
    },
    "import.rollback": {
      "$ref": "#/$defs/T167"
    },
    "import.setMapping": {
      "$ref": "#/$defs/T162"
    },
    "import.suggestions": {
      "$ref": "#/$defs/T54"
    },
    "insight.activitySeries": {
      "$ref": "#/$defs/T199"
    },
    "insight.burnDown": {
      "$ref": "#/$defs/T193"
    },
    "insight.burndown": {
      "$ref": "#/$defs/T193"
    },
    "insight.cumulativeFlow": {
      "$ref": "#/$defs/T196"
    },
    "insight.projectActivity": {
      "$ref": "#/$defs/T199"
    },
    "intake.convertSubmission": {
      "anyOf": [
        {
          "$ref": "#/$defs/T156"
        },
        {
          "$ref": "#/$defs/T157"
        }
      ]
    },
    "intake.createForm": {
      "$ref": "#/$defs/T440"
    },
    "intake.deleteForm": {
      "$ref": "#/$defs/T442"
    },
    "intake.getForm": {
      "$ref": "#/$defs/T149"
    },
    "intake.listForms": {
      "$ref": "#/$defs/T439"
    },
    "intake.listSubmissions": {
      "$ref": "#/$defs/T154"
    },
    "intake.rejectSubmission": {
      "$ref": "#/$defs/T443"
    },
    "intake.rotateToken": {
      "$ref": "#/$defs/T441"
    },
    "intake.updateForm": {
      "$ref": "#/$defs/T153"
    },
    "integration.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T250"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "integration.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T251"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "integration.list": {
      "$ref": "#/$defs/T248"
    },
    "integration.sync": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T253"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "integration.syncStatus": {
      "$ref": "#/$defs/T252"
    },
    "integration.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T250"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "knowledge.ask": {
      "$ref": "#/$defs/T423"
    },
    "knowledge.search": {
      "$ref": "#/$defs/T421"
    },
    "member.anonymize": {
      "$ref": "#/$defs/T302"
    },
    "member.assignOrganization": {
      "$ref": "#/$defs/T105"
    },
    "member.disable": {
      "$ref": "#/$defs/T302"
    },
    "member.enable": {
      "$ref": "#/$defs/T302"
    },
    "member.get": {
      "$ref": "#/$defs/T297"
    },
    "member.getPermissions": {
      "$ref": "#/$defs/T298"
    },
    "member.list": {
      "$ref": "#/$defs/T189"
    },
    "meta.capabilities": {
      "$ref": "#/$defs/T61"
    },
    "meta.fields": {
      "$ref": "#/$defs/T425"
    },
    "meta.tool": {
      "$ref": "#/$defs/T85"
    },
    "meta.workflow": {
      "$ref": "#/$defs/T414"
    },
    "notification.getPrefs": {
      "$ref": "#/$defs/T145"
    },
    "notification.list": {
      "$ref": "#/$defs/T410"
    },
    "notification.markRead": {
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            },
            "scope": {
              "const": "one",
              "type": "string"
            },
            "id": {
              "type": "string"
            }
          },
          "required": [
            "ok",
            "scope",
            "id"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            },
            "scope": {
              "const": "all",
              "type": "string"
            }
          },
          "required": [
            "ok",
            "scope"
          ],
          "additionalProperties": false
        }
      ]
    },
    "notification.setPrefs": {
      "$ref": "#/$defs/T145"
    },
    "organization.applyTemplate": {
      "$ref": "#/$defs/T106"
    },
    "organization.archiveDepartment": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "organization.archivePosition": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "organization.assignMember": {
      "$ref": "#/$defs/T105"
    },
    "organization.createDepartment": {
      "$ref": "#/$defs/T99"
    },
    "organization.createPosition": {
      "$ref": "#/$defs/T103"
    },
    "organization.departments": {
      "$ref": "#/$defs/T97"
    },
    "organization.get": {
      "$ref": "#/$defs/T288"
    },
    "organization.getTemplate": {
      "$ref": "#/$defs/T290"
    },
    "organization.positions": {
      "$ref": "#/$defs/T101"
    },
    "organization.update": {
      "$ref": "#/$defs/T289"
    },
    "organization.updateDepartment": {
      "$ref": "#/$defs/T100"
    },
    "organization.updatePosition": {
      "$ref": "#/$defs/T104"
    },
    "page.create": {
      "$ref": "#/$defs/T476"
    },
    "page.delete": {
      "$ref": "#/$defs/T134"
    },
    "page.get": {
      "$ref": "#/$defs/T420"
    },
    "page.getPermissions": {
      "$ref": "#/$defs/T49"
    },
    "page.getRevision": {
      "$ref": "#/$defs/T48"
    },
    "page.list": {
      "$ref": "#/$defs/T418"
    },
    "page.permissions": {
      "$ref": "#/$defs/T138"
    },
    "page.restore": {
      "$ref": "#/$defs/T136"
    },
    "page.revisions": {
      "$ref": "#/$defs/T135"
    },
    "page.setPermissions": {
      "$ref": "#/$defs/T139"
    },
    "page.update": {
      "$ref": "#/$defs/T461"
    },
    "ping": {
      "$ref": "#/$defs/T380"
    },
    "plan.addMilestoneProgressUpdate": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T287"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.archiveIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.archiveMilestone": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.archiveModule": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.archiveRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.completeIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T265"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.completeRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T265"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.createIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T479"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.createMilestone": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T282"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.createModule": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T480"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.createRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T481"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.deleteMilestoneProgressUpdate": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T269"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.getIteration": {
      "$ref": "#/$defs/T479"
    },
    "plan.getMilestone": {
      "$ref": "#/$defs/T405"
    },
    "plan.getModule": {
      "$ref": "#/$defs/T480"
    },
    "plan.getRelease": {
      "$ref": "#/$defs/T481"
    },
    "plan.iterationCapacity": {
      "$ref": "#/$defs/T275"
    },
    "plan.listIterations": {
      "$ref": "#/$defs/T406"
    },
    "plan.listMilestones": {
      "$ref": "#/$defs/T403"
    },
    "plan.listModules": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T274"
      }
    },
    "plan.listReleases": {
      "$ref": "#/$defs/T408"
    },
    "plan.milestoneDetail": {
      "$ref": "#/$defs/T281"
    },
    "plan.milestoneProgressUpdates": {
      "$ref": "#/$defs/T286"
    },
    "plan.setIterationCapacity": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T277"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.unarchiveIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.unarchiveMilestone": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.unarchiveModule": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.unarchiveRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "object",
          "properties": {
            "ok": {
              "type": "boolean"
            }
          },
          "required": [
            "ok"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.updateIteration": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T479"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.updateMilestone": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T282"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.updateModule": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T480"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "plan.updateRelease": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T481"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "portfolio.addProject": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T231"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "portfolio.create": {
      "$ref": "#/$defs/T229"
    },
    "portfolio.delete": {
      "$ref": "#/$defs/T438"
    },
    "portfolio.get": {
      "$ref": "#/$defs/T227"
    },
    "portfolio.list": {
      "$ref": "#/$defs/T437"
    },
    "portfolio.removeProject": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T232"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "portfolio.summary": {
      "$ref": "#/$defs/T233"
    },
    "portfolio.update": {
      "$ref": "#/$defs/T230"
    },
    "position.archive": {
      "$ref": "#/$defs/T294"
    },
    "position.create": {
      "$ref": "#/$defs/T103"
    },
    "position.list": {
      "$ref": "#/$defs/T101"
    },
    "position.update": {
      "$ref": "#/$defs/T104"
    },
    "prefs.get": {
      "$ref": "#/$defs/T122"
    },
    "prefs.update": {
      "$ref": "#/$defs/T122"
    },
    "product.create": {
      "$ref": "#/$defs/T309"
    },
    "product.get": {
      "$ref": "#/$defs/T309"
    },
    "product.linkProject": {
      "$ref": "#/$defs/T309"
    },
    "product.list": {
      "$ref": "#/$defs/T308"
    },
    "product.unlinkProject": {
      "$ref": "#/$defs/T310"
    },
    "product.update": {
      "$ref": "#/$defs/T309"
    },
    "project.archive": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T185"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.context": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "project": {
          "$ref": "#/$defs/T389"
        },
        "members": {
          "anyOf": [
            {
              "$ref": "#/$defs/T395"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "workflows": {
          "anyOf": [
            {
              "$ref": "#/$defs/T414"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "fields": {
          "anyOf": [
            {
              "$ref": "#/$defs/T425"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "customFields": {
          "anyOf": [
            {
              "$ref": "#/$defs/T242"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "iterations": {
          "anyOf": [
            {
              "$ref": "#/$defs/T406"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "milestones": {
          "anyOf": [
            {
              "$ref": "#/$defs/T403"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "releases": {
          "anyOf": [
            {
              "$ref": "#/$defs/T408"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "modules": {
          "anyOf": [
            {
              "type": "array",
              "items": {
                "$ref": "#/$defs/T274"
              }
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        },
        "workItems": {
          "anyOf": [
            {
              "$ref": "#/$defs/T397"
            },
            {
              "type": "object",
              "properties": {
                "unavailable": {
                  "type": "boolean",
                  "const": true
                },
                "code": {
                  "type": "string"
                },
                "tool": {
                  "type": "string"
                }
              },
              "required": [
                "unavailable",
                "code",
                "tool"
              ],
              "additionalProperties": false
            }
          ]
        }
      },
      "required": [
        "projectId",
        "project",
        "members",
        "workflows",
        "fields",
        "customFields",
        "iterations",
        "milestones",
        "releases",
        "modules",
        "workItems"
      ],
      "additionalProperties": false
    },
    "project.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T29"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.createFromTemplate": {
      "$ref": "#/$defs/T28"
    },
    "project.exportCsv": {
      "$ref": "#/$defs/T247"
    },
    "project.get": {
      "$ref": "#/$defs/T389"
    },
    "project.list": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "key": {
                "type": "string"
              },
              "name": {
                "type": "string"
              },
              "status": {
                "anyOf": [
                  {
                    "type": "object",
                    "properties": {
                      "key": {
                        "type": "string"
                      },
                      "name": {
                        "type": "string"
                      },
                      "category": {
                        "type": "string"
                      }
                    },
                    "required": [
                      "key",
                      "name",
                      "category"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "workItemCount": {
                "type": "integer"
              }
            },
            "required": [
              "id",
              "key",
              "name",
              "status",
              "workItemCount"
            ],
            "additionalProperties": false
          }
        },
        "total": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total"
      ],
      "additionalProperties": false
    },
    "project.member.add": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T187"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.member.remove": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T188"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.members": {
      "$ref": "#/$defs/T395"
    },
    "project.report": {
      "$ref": "#/$defs/T246"
    },
    "project.status": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T186"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.unarchive": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T185"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "project.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T184"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "projectTemplate.create": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T25"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "projectTemplate.createProject": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T28"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "projectTemplate.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T188"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "projectTemplate.get": {
      "$ref": "#/$defs/T24"
    },
    "projectTemplate.list": {
      "$ref": "#/$defs/T192"
    },
    "projectTemplate.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T26"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "rag.chat": {
      "$ref": "#/$defs/T318"
    },
    "rag.conversation.action": {
      "$ref": "#/$defs/T335"
    },
    "rag.conversation.cancel": {
      "$ref": "#/$defs/T335"
    },
    "rag.conversation.create": {
      "$ref": "#/$defs/T315"
    },
    "rag.conversation.execution": {
      "$ref": "#/$defs/T311"
    },
    "rag.conversation.get": {
      "$ref": "#/$defs/T337"
    },
    "rag.conversation.list": {
      "$ref": "#/$defs/T336"
    },
    "rag.conversation.propose": {
      "$ref": "#/$defs/T311"
    },
    "rag.conversation.revise": {
      "$ref": "#/$defs/T311"
    },
    "rag.conversation.send": {
      "$ref": "#/$defs/T335"
    },
    "rag.conversation.update": {
      "$ref": "#/$defs/T315"
    },
    "rag.projects": {
      "$ref": "#/$defs/T338"
    },
    "rag.search": {
      "$ref": "#/$defs/T340"
    },
    "requirementChange.acknowledge": {
      "$ref": "#/$defs/T353"
    },
    "requirementChange.apply": {
      "$ref": "#/$defs/T353"
    },
    "requirementChange.context": {
      "$ref": "#/$defs/T348"
    },
    "requirementChange.create": {
      "$ref": "#/$defs/T353"
    },
    "requirementChange.decide": {
      "$ref": "#/$defs/T353"
    },
    "requirementChange.get": {
      "$ref": "#/$defs/T353"
    },
    "requirementChange.list": {
      "$ref": "#/$defs/T351"
    },
    "role.assign": {
      "$ref": "#/$defs/T96"
    },
    "role.assignments": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T96"
      }
    },
    "role.create": {
      "$ref": "#/$defs/T88"
    },
    "role.createAssignment": {
      "$ref": "#/$defs/T96"
    },
    "role.delete": {
      "$ref": "#/$defs/T305"
    },
    "role.deleteAssignment": {
      "$ref": "#/$defs/T307"
    },
    "role.getAssignment": {
      "$ref": "#/$defs/T96"
    },
    "role.list": {
      "$ref": "#/$defs/T303"
    },
    "role.listAssignments": {
      "$ref": "#/$defs/T306"
    },
    "role.listPermissions": {
      "$ref": "#/$defs/T304"
    },
    "role.listScopes": {
      "anyOf": [
        {
          "$ref": "#/$defs/T90"
        },
        {
          "$ref": "#/$defs/T92"
        },
        {
          "$ref": "#/$defs/T94"
        }
      ]
    },
    "role.permissions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T86"
      }
    },
    "role.revoke": {
      "$ref": "#/$defs/T89"
    },
    "role.scopeOptions": {
      "anyOf": [
        {
          "$ref": "#/$defs/T90"
        },
        {
          "$ref": "#/$defs/T92"
        },
        {
          "$ref": "#/$defs/T94"
        }
      ]
    },
    "role.update": {
      "$ref": "#/$defs/T88"
    },
    "role.updateAssignment": {
      "$ref": "#/$defs/T96"
    },
    "savedView.create": {
      "$ref": "#/$defs/T450"
    },
    "savedView.delete": {
      "$ref": "#/$defs/T452"
    },
    "savedView.get": {
      "$ref": "#/$defs/T279"
    },
    "savedView.list": {
      "$ref": "#/$defs/T449"
    },
    "savedView.reorder": {
      "$ref": "#/$defs/T453"
    },
    "savedView.update": {
      "$ref": "#/$defs/T451"
    },
    "sla.createPolicy": {
      "$ref": "#/$defs/T125"
    },
    "sla.deletePolicy": {
      "$ref": "#/$defs/T128"
    },
    "sla.get": {
      "$ref": "#/$defs/T428"
    },
    "sla.listPolicies": {
      "$ref": "#/$defs/T123"
    },
    "sla.pause": {
      "$ref": "#/$defs/T487"
    },
    "sla.resume": {
      "$ref": "#/$defs/T487"
    },
    "sla.updatePolicy": {
      "$ref": "#/$defs/T127"
    },
    "team.create": {
      "$ref": "#/$defs/T110"
    },
    "team.delete": {
      "$ref": "#/$defs/T296"
    },
    "team.list": {
      "$ref": "#/$defs/T295"
    },
    "team.members": {
      "$ref": "#/$defs/T108"
    },
    "team.update": {
      "$ref": "#/$defs/T111"
    },
    "testCase.create": {
      "$ref": "#/$defs/T377"
    },
    "testCase.get": {
      "$ref": "#/$defs/T377"
    },
    "testCase.getRevision": {
      "$ref": "#/$defs/T367"
    },
    "testCase.list": {
      "$ref": "#/$defs/T375"
    },
    "testCase.revisions": {
      "$ref": "#/$defs/T378"
    },
    "testCase.update": {
      "$ref": "#/$defs/T377"
    },
    "testPlan.create": {
      "$ref": "#/$defs/T358"
    },
    "testPlan.get": {
      "$ref": "#/$defs/T358"
    },
    "testPlan.list": {
      "$ref": "#/$defs/T356"
    },
    "testPlan.report": {
      "$ref": "#/$defs/T361"
    },
    "testPlan.transition": {
      "$ref": "#/$defs/T358"
    },
    "testPlan.update": {
      "$ref": "#/$defs/T358"
    },
    "testRun.complete": {
      "$ref": "#/$defs/T365"
    },
    "testRun.createDefect": {
      "$ref": "#/$defs/T371"
    },
    "testRun.get": {
      "$ref": "#/$defs/T365"
    },
    "testRun.linkDefect": {
      "$ref": "#/$defs/T371"
    },
    "testRun.record": {
      "$ref": "#/$defs/T365"
    },
    "testRun.start": {
      "$ref": "#/$defs/T365"
    },
    "testSuite.create": {
      "$ref": "#/$defs/T374"
    },
    "testSuite.get": {
      "$ref": "#/$defs/T374"
    },
    "testSuite.list": {
      "$ref": "#/$defs/T373"
    },
    "testSuite.update": {
      "$ref": "#/$defs/T374"
    },
    "timeLog.create": {
      "$ref": "#/$defs/T117"
    },
    "timeLog.delete": {
      "$ref": "#/$defs/T89"
    },
    "timeLog.list": {
      "$ref": "#/$defs/T115"
    },
    "timeLog.update": {
      "$ref": "#/$defs/T112"
    },
    "todo.create": {
      "$ref": "#/$defs/T175"
    },
    "todo.delete": {
      "$ref": "#/$defs/T445"
    },
    "todo.list": {
      "$ref": "#/$defs/T444"
    },
    "todo.update": {
      "$ref": "#/$defs/T176"
    },
    "webhook.create": {
      "$ref": "#/$defs/T258"
    },
    "webhook.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T261"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "webhook.deliveries": {
      "$ref": "#/$defs/T262"
    },
    "webhook.list": {
      "$ref": "#/$defs/T256"
    },
    "webhook.replay": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T264"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "webhook.update": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T260"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "whoami": {
      "$ref": "#/$defs/T383"
    },
    "workbench.get": {
      "$ref": "#/$defs/T168"
    },
    "workflow.addState": {
      "$ref": "#/$defs/T38"
    },
    "workflow.addTransition": {
      "$ref": "#/$defs/T43"
    },
    "workflow.archiveState": {
      "$ref": "#/$defs/T89"
    },
    "workflow.create": {
      "$ref": "#/$defs/T34"
    },
    "workflow.list": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T33"
      }
    },
    "workflow.listStates": {
      "$ref": "#/$defs/T36"
    },
    "workflow.listTransitions": {
      "$ref": "#/$defs/T41"
    },
    "workflow.removeTransition": {
      "$ref": "#/$defs/T89"
    },
    "workflow.states": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T37"
      }
    },
    "workflow.transitions": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T42"
      }
    },
    "workflow.update": {
      "$ref": "#/$defs/T35"
    },
    "workflow.updateState": {
      "$ref": "#/$defs/T39"
    },
    "workflow.updateTransition": {
      "$ref": "#/$defs/T44"
    },
    "workitem.addCollaborator": {
      "$ref": "#/$defs/T11"
    },
    "workitem.addProgress": {
      "$ref": "#/$defs/T4"
    },
    "workitem.addProgressUpdate": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T4"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.assign": {
      "$ref": "#/$defs/T468"
    },
    "workitem.children": {
      "$ref": "#/$defs/T266"
    },
    "workitem.collaborators": {
      "$ref": "#/$defs/T113"
    },
    "workitem.comment": {
      "$ref": "#/$defs/T469"
    },
    "workitem.comments": {
      "$ref": "#/$defs/T402"
    },
    "workitem.contentLinks": {
      "$ref": "#/$defs/T118"
    },
    "workitem.create": {
      "$ref": "#/$defs/T467"
    },
    "workitem.createContentLink": {
      "$ref": "#/$defs/T121"
    },
    "workitem.delete": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T269"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.deleteContentLink": {
      "$ref": "#/$defs/T89"
    },
    "workitem.deleteProgress": {
      "$ref": "#/$defs/T5"
    },
    "workitem.deleteProgressUpdate": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T269"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.follow": {
      "$ref": "#/$defs/T89"
    },
    "workitem.get": {
      "$ref": "#/$defs/T399"
    },
    "workitem.link": {
      "$ref": "#/$defs/T470"
    },
    "workitem.list": {
      "$ref": "#/$defs/T397"
    },
    "workitem.listCollaborators": {
      "$ref": "#/$defs/T9"
    },
    "workitem.listProgress": {
      "$ref": "#/$defs/T2"
    },
    "workitem.listTransfers": {
      "$ref": "#/$defs/T6"
    },
    "workitem.listWatchers": {
      "$ref": "#/$defs/T13"
    },
    "workitem.progressUpdates": {
      "$ref": "#/$defs/T280"
    },
    "workitem.relations": {
      "$ref": "#/$defs/T270"
    },
    "workitem.removeCollaborator": {
      "$ref": "#/$defs/T89"
    },
    "workitem.transfer": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T8"
            }
          ]
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.transfers": {
      "type": "array",
      "items": {
        "$ref": "#/$defs/T7"
      }
    },
    "workitem.transition": {
      "$ref": "#/$defs/T8"
    },
    "workitem.unfollow": {
      "$ref": "#/$defs/T89"
    },
    "workitem.unlink": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T269"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "workitem.update": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "$ref": "#/$defs/T8"
        }
      ]
    },
    "workitem.watchers": {
      "$ref": "#/$defs/T114"
    }
  },
  "definitions": {
    "JsonValue": {
      "anyOf": [
        {
          "type": "null"
        },
        {
          "type": "boolean"
        },
        {
          "type": "number"
        },
        {
          "type": "string"
        },
        {
          "type": "array",
          "items": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      ]
    },
    "T1": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T2": {
      "type": "object",
      "properties": {
        "updates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T3"
          }
        }
      },
      "required": [
        "updates"
      ],
      "additionalProperties": false
    },
    "T3": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "summary": {
          "type": "string"
        },
        "nextSteps": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "blockers": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "authorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "authorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "summary",
        "nextSteps",
        "blockers",
        "createdAt",
        "authorId",
        "authorName"
      ],
      "additionalProperties": false
    },
    "T4": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "authorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "summary": {
          "type": "string"
        },
        "nextSteps": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "blockers": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "workItemId",
        "id",
        "createdAt",
        "authorId",
        "summary",
        "nextSteps",
        "blockers"
      ],
      "additionalProperties": false
    },
    "T5": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T6": {
      "type": "object",
      "properties": {
        "transfers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T7"
          }
        }
      },
      "required": [
        "transfers"
      ],
      "additionalProperties": false
    },
    "T7": {
      "type": "object",
      "properties": {
        "fromName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "toName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "actorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "fromAssigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "toAssigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "actorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "reason": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "fromName",
        "toName",
        "actorName",
        "id",
        "fromAssigneeId",
        "toAssigneeId",
        "actorId",
        "reason",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T8": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "key": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workflowId": {
          "type": "string"
        },
        "statusId": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "milestoneId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "iterationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "moduleId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "productId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "assigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "reporterId": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "estimatePoints": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "estimateHours": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "version": {
          "type": "integer"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "number",
        "key",
        "type",
        "title",
        "description",
        "workflowId",
        "statusId",
        "parentId",
        "milestoneId",
        "iterationId",
        "releaseId",
        "moduleId",
        "productId",
        "assigneeId",
        "reporterId",
        "priority",
        "severity",
        "estimatePoints",
        "estimateHours",
        "startDate",
        "dueDate",
        "completedAt",
        "version",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T9": {
      "type": "object",
      "properties": {
        "collaborators": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T10"
          }
        }
      },
      "required": [
        "collaborators"
      ],
      "additionalProperties": false
    },
    "T10": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "memberId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T11": {
      "type": "object",
      "properties": {
        "workItemId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "memberId": {
          "type": "string"
        }
      },
      "required": [
        "workItemId",
        "createdAt",
        "memberId"
      ],
      "additionalProperties": false
    },
    "T12": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T13": {
      "type": "object",
      "properties": {
        "watchers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T14"
          }
        }
      },
      "required": [
        "watchers"
      ],
      "additionalProperties": false
    },
    "T14": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "channels": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "memberId",
        "name",
        "username",
        "channels"
      ],
      "additionalProperties": false
    },
    "T15": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T16": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T17": {
      "type": "object",
      "properties": {
        "comments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T18"
          }
        }
      },
      "required": [
        "comments"
      ],
      "additionalProperties": false
    },
    "T18": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "editedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "targetType",
        "targetId",
        "authorId",
        "body",
        "parentId",
        "editedAt",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T19": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "authorId": {
          "type": "string"
        },
        "targetId": {
          "type": "string"
        },
        "targetType": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "editedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "createdAt",
        "updatedAt",
        "parentId",
        "deletedAt",
        "authorId",
        "targetId",
        "targetType",
        "body",
        "editedAt"
      ],
      "additionalProperties": false
    },
    "T20": {
      "type": "object",
      "properties": {
        "values": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T21"
          }
        }
      },
      "required": [
        "values"
      ],
      "additionalProperties": false
    },
    "T21": {
      "type": "object",
      "properties": {
        "defId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "archived": {
          "type": "boolean"
        },
        "value": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "defId",
        "key",
        "name",
        "type",
        "archived",
        "value"
      ],
      "additionalProperties": false
    },
    "T22": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T21"
          }
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T23": {
      "type": "object",
      "properties": {
        "templates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T24"
          }
        }
      },
      "required": [
        "templates"
      ],
      "additionalProperties": false
    },
    "T24": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "payload": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "isBuiltin",
        "payload",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T25": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "payload": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "id",
        "name",
        "createdAt",
        "isBuiltin",
        "payload"
      ],
      "additionalProperties": false
    },
    "T26": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "payload": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "isBuiltin",
        "payload",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T27": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T28": {
      "type": "object",
      "properties": {
        "project": {
          "$ref": "#/$defs/T29"
        },
        "applied": {
          "$ref": "#/$defs/T30"
        },
        "failures": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T31"
          }
        }
      },
      "required": [
        "project",
        "applied",
        "failures"
      ],
      "additionalProperties": false
    },
    "T29": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key"
      ],
      "additionalProperties": false
    },
    "T30": {
      "type": "object",
      "properties": {
        "milestones": {
          "type": "number"
        },
        "iterations": {
          "type": "number"
        },
        "workItems": {
          "type": "number"
        }
      },
      "required": [
        "milestones",
        "iterations",
        "workItems"
      ],
      "additionalProperties": false
    },
    "T31": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "error": {
          "type": "string"
        }
      },
      "required": [
        "kind",
        "name",
        "error"
      ],
      "additionalProperties": false
    },
    "T32": {
      "type": "object",
      "properties": {
        "workflows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T33"
          }
        }
      },
      "required": [
        "workflows"
      ],
      "additionalProperties": false
    },
    "T33": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "isBuiltin": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "appliesToType",
        "isDefault",
        "isBuiltin"
      ],
      "additionalProperties": false
    },
    "T34": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "isBuiltin",
        "appliesToType",
        "isDefault"
      ],
      "additionalProperties": false
    },
    "T35": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "isBuiltin": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "appliesToType",
        "isDefault",
        "isBuiltin"
      ],
      "additionalProperties": false
    },
    "T36": {
      "type": "object",
      "properties": {
        "states": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T37"
          }
        }
      },
      "required": [
        "states"
      ],
      "additionalProperties": false
    },
    "T37": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "wipLimit": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "workflowId",
        "key",
        "name",
        "category",
        "color",
        "wipLimit",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T38": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "wipLimit": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        }
      },
      "required": [
        "key",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "category",
        "color",
        "workflowId",
        "wipLimit"
      ],
      "additionalProperties": false
    },
    "T39": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "wipLimit": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "workflowId",
        "key",
        "name",
        "category",
        "color",
        "wipLimit",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T40": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T41": {
      "type": "object",
      "properties": {
        "transitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T42"
          }
        }
      },
      "required": [
        "transitions"
      ],
      "additionalProperties": false
    },
    "T42": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "allowedRoleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiresApproval": {
          "type": "boolean"
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "label": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "workflowId",
        "fromStateId",
        "toStateId",
        "allowedRoleIds",
        "requiredFields",
        "requiresApproval",
        "approverRoleKeys",
        "label",
        "sortOrder"
      ],
      "additionalProperties": false
    },
    "T43": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "allowedRoleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiresApproval": {
          "type": "boolean"
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "label": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "sortOrder",
        "workflowId",
        "fromStateId",
        "toStateId",
        "allowedRoleIds",
        "requiredFields",
        "requiresApproval",
        "approverRoleKeys",
        "label"
      ],
      "additionalProperties": false
    },
    "T44": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "allowedRoleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiresApproval": {
          "type": "boolean"
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "label": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "workflowId",
        "fromStateId",
        "toStateId",
        "allowedRoleIds",
        "requiredFields",
        "requiresApproval",
        "approverRoleKeys",
        "label",
        "sortOrder"
      ],
      "additionalProperties": false
    },
    "T45": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T46": {
      "type": "object",
      "properties": {
        "revisions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T47"
          }
        }
      },
      "required": [
        "revisions"
      ],
      "additionalProperties": false
    },
    "T47": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "changeSummary": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "authorId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "revisionNo",
        "changeSummary",
        "authorId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T48": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "pageId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "content": {
          "type": "string"
        },
        "changeSummary": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "authorId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "pageId",
        "revisionNo",
        "content",
        "changeSummary",
        "authorId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T49": {
      "type": "object",
      "properties": {
        "permissions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T50"
          }
        }
      },
      "required": [
        "permissions"
      ],
      "additionalProperties": false
    },
    "T50": {
      "type": "object",
      "properties": {
        "pageId": {
          "type": "string"
        },
        "principalType": {
          "type": "string"
        },
        "principalId": {
          "type": "string"
        },
        "canRead": {
          "type": "boolean"
        },
        "canWrite": {
          "type": "boolean"
        }
      },
      "required": [
        "pageId",
        "principalType",
        "principalId",
        "canRead",
        "canWrite"
      ],
      "additionalProperties": false
    },
    "T51": {
      "type": "object",
      "properties": {
        "batches": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T52"
          }
        }
      },
      "required": [
        "batches"
      ],
      "additionalProperties": false
    },
    "T52": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "filename": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "mappingConfig": {
          "$ref": "#/$defs/JsonValue"
        },
        "totalRows": {
          "type": "number"
        },
        "createdCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "errorReport": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "projectId",
        "source",
        "filename",
        "status",
        "mappingConfig",
        "totalRows",
        "createdCount",
        "failedCount",
        "errorReport",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T53": {
      "type": "object",
      "properties": {
        "rows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "offset": {
          "type": "integer"
        },
        "limit": {
          "type": "integer"
        },
        "hasMore": {
          "type": "boolean"
        },
        "errorReport": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "errorOffset": {
          "type": "number"
        },
        "errorLimit": {
          "type": "number"
        },
        "errorCount": {
          "type": "integer"
        },
        "errorHasMore": {
          "type": "boolean"
        },
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "fieldMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "encoding": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/JsonValue"
            }
          ]
        },
        "preview": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/JsonValue"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "filename": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "mappingConfig": {
          "$ref": "#/$defs/JsonValue"
        },
        "totalRows": {
          "type": "number"
        },
        "createdCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "rows",
        "offset",
        "limit",
        "hasMore",
        "errorReport",
        "errorOffset",
        "errorLimit",
        "errorCount",
        "errorHasMore",
        "header",
        "fieldMap",
        "encoding",
        "preview",
        "id",
        "projectId",
        "source",
        "filename",
        "status",
        "mappingConfig",
        "totalRows",
        "createdCount",
        "failedCount",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T54": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string"
        },
        "fieldMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "valueMaps": {
          "type": "object",
          "additionalProperties": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            }
          }
        },
        "externalIdColumn": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "unmatchedColumns": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "notes": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "delimiter": {
          "type": "string"
        }
      },
      "required": [
        "source",
        "fieldMap",
        "valueMaps",
        "externalIdColumn",
        "unmatchedColumns",
        "notes",
        "delimiter"
      ],
      "additionalProperties": false
    },
    "T55": {
      "type": "object",
      "properties": {
        "count": {
          "type": "number"
        },
        "filename": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "contentBase64": {
          "type": "string"
        },
        "size": {
          "type": "number"
        }
      },
      "required": [
        "count",
        "filename",
        "mimeType",
        "contentBase64",
        "size"
      ],
      "additionalProperties": false
    },
    "T56": {
      "type": "object",
      "properties": {
        "filename": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "contentBase64": {
          "type": "string"
        },
        "size": {
          "type": "number"
        }
      },
      "required": [
        "filename",
        "mimeType",
        "contentBase64",
        "size"
      ],
      "additionalProperties": false
    },
    "T57": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "integrationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "repository": {
          "type": "string"
        },
        "apiBaseUrl": {
          "type": "string"
        },
        "version": {
          "type": "integer"
        },
        "enabled": {
          "type": "boolean"
        },
        "configCurrent": {
          "type": "boolean"
        },
        "hasWebhookSecret": {
          "type": "boolean"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "integrationId",
        "name",
        "repository",
        "apiBaseUrl",
        "version",
        "enabled",
        "configCurrent",
        "hasWebhookSecret",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T58": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T59"
          }
        },
        "nextCursor": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "items",
        "nextCursor"
      ],
      "additionalProperties": false
    },
    "T59": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "sourceId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sourceVersion": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "kind": {
          "type": "string",
          "enum": [
            "COMMIT",
            "PULL_REQUEST",
            "CI",
            "BUILD",
            "DEPLOYMENT"
          ]
        },
        "title": {
          "type": "string"
        },
        "repository": {
          "type": "string"
        },
        "commitSha": {
          "type": "string"
        },
        "build": {
          "type": "string"
        },
        "environment": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "PENDING",
            "CANCELLED",
            "FAILED",
            "SUCCEEDED"
          ]
        },
        "verification": {
          "type": "string",
          "enum": [
            "SELF_REPORTED",
            "PROVIDER_API"
          ]
        },
        "externalId": {
          "type": "string"
        },
        "attempt": {
          "type": "number"
        },
        "providerUpdatedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "url": {
          "type": "string"
        },
        "details": {
          "type": "object",
          "additionalProperties": {
            "anyOf": [
              {
                "type": "null"
              },
              {
                "type": "string"
              },
              {
                "type": "number"
              },
              {
                "type": "boolean",
                "const": false
              },
              {
                "type": "boolean",
                "const": true
              }
            ]
          }
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "receivedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sourceCurrent": {
          "type": "boolean"
        },
        "workItems": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T60"
          }
        }
      },
      "required": [
        "id",
        "projectId",
        "sourceId",
        "sourceVersion",
        "kind",
        "title",
        "repository",
        "commitSha",
        "build",
        "environment",
        "status",
        "verification",
        "externalId",
        "attempt",
        "providerUpdatedAt",
        "url",
        "details",
        "createdBy",
        "receivedAt",
        "sourceCurrent",
        "workItems"
      ],
      "additionalProperties": false
    },
    "T60": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T61": {
      "type": "object",
      "properties": {
        "toolCount": {
          "type": "integer"
        },
        "tools": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T62"
          }
        },
        "workflows": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "$ref": "#/$defs/T63"
              },
              {
                "$ref": "#/$defs/T64"
              },
              {
                "$ref": "#/$defs/T65"
              },
              {
                "$ref": "#/$defs/T66"
              },
              {
                "$ref": "#/$defs/T67"
              },
              {
                "$ref": "#/$defs/T68"
              },
              {
                "$ref": "#/$defs/T69"
              },
              {
                "$ref": "#/$defs/T70"
              },
              {
                "$ref": "#/$defs/T71"
              },
              {
                "$ref": "#/$defs/T72"
              },
              {
                "$ref": "#/$defs/T73"
              },
              {
                "$ref": "#/$defs/T74"
              },
              {
                "$ref": "#/$defs/T75"
              },
              {
                "$ref": "#/$defs/T76"
              },
              {
                "$ref": "#/$defs/T77"
              },
              {
                "$ref": "#/$defs/T78"
              },
              {
                "$ref": "#/$defs/T79"
              },
              {
                "$ref": "#/$defs/T80"
              },
              {
                "$ref": "#/$defs/T81"
              },
              {
                "$ref": "#/$defs/T82"
              },
              {
                "$ref": "#/$defs/T83"
              }
            ]
          }
        },
        "completionRule": {
          "type": "string"
        },
        "boundaries": {
          "$ref": "#/$defs/T84"
        }
      },
      "required": [
        "toolCount",
        "tools",
        "workflows",
        "completionRule",
        "boundaries"
      ],
      "additionalProperties": false
    },
    "T62": {
      "type": "object",
      "properties": {
        "available": {
          "type": "boolean"
        },
        "reason": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "read",
            "write"
          ]
        },
        "scope": {
          "type": "string"
        },
        "confirmationRequired": {
          "type": "boolean"
        },
        "idempotentWithoutKey": {
          "type": "boolean"
        },
        "idempotencyKey": {
          "type": "boolean"
        }
      },
      "required": [
        "available",
        "reason",
        "name",
        "description",
        "kind",
        "scope",
        "confirmationRequired",
        "idempotentWithoutKey",
        "idempotencyKey"
      ],
      "additionalProperties": false
    },
    "T63": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "delivery"
        },
        "purpose": {
          "type": "string",
          "const": "需求拆解、排期、执行与验收回写"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "project.context"
              },
              {
                "type": "string",
                "const": "workitem.list"
              },
              {
                "type": "string",
                "const": "workitem.create"
              },
              {
                "type": "string",
                "const": "workitem.children"
              },
              {
                "type": "string",
                "const": "workitem.update"
              },
              {
                "type": "string",
                "const": "workitem.assign"
              },
              {
                "type": "string",
                "const": "workitem.get"
              },
              {
                "type": "string",
                "const": "workitem.transition"
              },
              {
                "type": "string",
                "const": "workitem.comment"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T64": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "planning"
        },
        "purpose": {
          "type": "string",
          "const": "创建计划、关联任务、迭代结束结转与版本完成归档"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "plan.listIterations"
              },
              {
                "type": "string",
                "const": "plan.createIteration"
              },
              {
                "type": "string",
                "const": "workitem.list"
              },
              {
                "type": "string",
                "const": "workitem.update"
              },
              {
                "type": "string",
                "const": "plan.getIteration"
              },
              {
                "type": "string",
                "const": "plan.updateIteration"
              },
              {
                "type": "string",
                "const": "plan.completeIteration"
              },
              {
                "type": "string",
                "const": "plan.getIteration"
              },
              {
                "type": "string",
                "const": "plan.completeRelease"
              },
              {
                "type": "string",
                "const": "plan.getRelease"
              },
              {
                "type": "string",
                "const": "plan.archiveIteration"
              },
              {
                "type": "string",
                "const": "plan.unarchiveIteration"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T65": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "ideas"
        },
        "purpose": {
          "type": "string",
          "const": "发现想法、评审、投票与转工作项"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "idea.list"
              },
              {
                "type": "string",
                "const": "idea.get"
              },
              {
                "type": "string",
                "const": "idea.update"
              },
              {
                "type": "string",
                "const": "idea.vote"
              },
              {
                "type": "string",
                "const": "idea.promote"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T66": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "documentation"
        },
        "purpose": {
          "type": "string",
          "const": "文档编写、历史复核与恢复"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "page.list"
              },
              {
                "type": "string",
                "const": "page.get"
              },
              {
                "type": "string",
                "const": "page.update"
              },
              {
                "type": "string",
                "const": "page.revisions"
              },
              {
                "type": "string",
                "const": "page.restore"
              },
              {
                "type": "string",
                "const": "page.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T67": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "automation"
        },
        "purpose": {
          "type": "string",
          "const": "规则建立、条件预演、修改与运行结果复核"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "automation.listRules"
              },
              {
                "type": "string",
                "const": "automation.createRule"
              },
              {
                "type": "string",
                "const": "automation.testRule"
              },
              {
                "type": "string",
                "const": "automation.updateRule"
              },
              {
                "type": "string",
                "const": "automation.listRuns"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T68": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "import"
        },
        "purpose": {
          "type": "string",
          "const": "导入、映射确认、预演、执行与可控回滚"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "import.create"
              },
              {
                "type": "string",
                "const": "import.suggestions"
              },
              {
                "type": "string",
                "const": "import.setMapping"
              },
              {
                "type": "string",
                "const": "import.dryRun"
              },
              {
                "type": "string",
                "const": "import.confirm"
              },
              {
                "type": "string",
                "const": "import.get"
              },
              {
                "type": "string",
                "const": "import.rollback"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T69": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "intake"
        },
        "purpose": {
          "type": "string",
          "const": "需求收集、评审与转化"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "intake.listForms"
              },
              {
                "type": "string",
                "const": "intake.listSubmissions"
              },
              {
                "type": "string",
                "const": "intake.convertSubmission"
              },
              {
                "type": "string",
                "const": "idea.get"
              },
              {
                "type": "string",
                "const": "idea.promote"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T70": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "project"
        },
        "purpose": {
          "type": "string",
          "const": "项目创建、成员配置与生命周期管理"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "project.create"
              },
              {
                "type": "string",
                "const": "member.list"
              },
              {
                "type": "string",
                "const": "role.list"
              },
              {
                "type": "string",
                "const": "project.member.add"
              },
              {
                "type": "string",
                "const": "project.members"
              },
              {
                "type": "string",
                "const": "project.update"
              },
              {
                "type": "string",
                "const": "project.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T71": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "analysis"
        },
        "purpose": {
          "type": "string",
          "const": "迭代分析与项目报告"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "plan.listIterations"
              },
              {
                "type": "string",
                "const": "insight.burnDown"
              },
              {
                "type": "string",
                "const": "insight.cumulativeFlow"
              },
              {
                "type": "string",
                "const": "project.report"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T72": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "workflow"
        },
        "purpose": {
          "type": "string",
          "const": "配置工作流、审批边与状态"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "workflow.list"
              },
              {
                "type": "string",
                "const": "workflow.states"
              },
              {
                "type": "string",
                "const": "workflow.addState"
              },
              {
                "type": "string",
                "const": "workflow.addTransition"
              },
              {
                "type": "string",
                "const": "workflow.updateTransition"
              },
              {
                "type": "string",
                "const": "meta.workflow"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T73": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "personal"
        },
        "purpose": {
          "type": "string",
          "const": "本人待办、时间安排与专注记录"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "todo.list"
              },
              {
                "type": "string",
                "const": "todo.create"
              },
              {
                "type": "string",
                "const": "todo.update"
              },
              {
                "type": "string",
                "const": "focus.blocks"
              },
              {
                "type": "string",
                "const": "focus.createBlock"
              },
              {
                "type": "string",
                "const": "focus.recordSession"
              },
              {
                "type": "string",
                "const": "focus.today"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T74": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "dependencies"
        },
        "purpose": {
          "type": "string",
          "const": "依赖建立、无环校验、复读与解除"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "workitem.get"
              },
              {
                "type": "string",
                "const": "workitem.relations"
              },
              {
                "type": "string",
                "const": "workitem.link"
              },
              {
                "type": "string",
                "const": "workitem.relations"
              },
              {
                "type": "string",
                "const": "workitem.unlink"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T75": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "collaboration"
        },
        "purpose": {
          "type": "string",
          "const": "协作、交接与工时回写"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "project.members"
              },
              {
                "type": "string",
                "const": "workitem.addCollaborator"
              },
              {
                "type": "string",
                "const": "workitem.collaborators"
              },
              {
                "type": "string",
                "const": "workitem.transfer"
              },
              {
                "type": "string",
                "const": "workitem.transfers"
              },
              {
                "type": "string",
                "const": "timeLog.create"
              },
              {
                "type": "string",
                "const": "timeLog.list"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T76": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "progress"
        },
        "purpose": {
          "type": "string",
          "const": "任务及里程碑进展汇报与复核"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "workitem.get"
              },
              {
                "type": "string",
                "const": "workitem.addProgressUpdate"
              },
              {
                "type": "string",
                "const": "workitem.progressUpdates"
              },
              {
                "type": "string",
                "const": "plan.addMilestoneProgressUpdate"
              },
              {
                "type": "string",
                "const": "plan.milestoneDetail"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T77": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "attachments"
        },
        "purpose": {
          "type": "string",
          "const": "附件上传、复读、安全下载与移除"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "attachment.list"
              },
              {
                "type": "string",
                "const": "attachment.upload"
              },
              {
                "type": "string",
                "const": "attachment.list"
              },
              {
                "type": "string",
                "const": "attachment.download"
              },
              {
                "type": "string",
                "const": "attachment.remove"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T78": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "fields"
        },
        "purpose": {
          "type": "string",
          "const": "字段定义、类型校验与带版本的赋值"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "customField.definitions"
              },
              {
                "type": "string",
                "const": "customField.create"
              },
              {
                "type": "string",
                "const": "workitem.get"
              },
              {
                "type": "string",
                "const": "customField.setValues"
              },
              {
                "type": "string",
                "const": "customField.getValues"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T79": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "views"
        },
        "purpose": {
          "type": "string",
          "const": "保存个人或共享视图、调整与复读"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "savedView.list"
              },
              {
                "type": "string",
                "const": "savedView.create"
              },
              {
                "type": "string",
                "const": "savedView.get"
              },
              {
                "type": "string",
                "const": "savedView.update"
              },
              {
                "type": "string",
                "const": "savedView.reorder"
              },
              {
                "type": "string",
                "const": "savedView.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T80": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "slaApproval"
        },
        "purpose": {
          "type": "string",
          "const": "SLA策略与时钟、审批决策与最终流转确认"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "sla.listPolicies"
              },
              {
                "type": "string",
                "const": "sla.createPolicy"
              },
              {
                "type": "string",
                "const": "sla.get"
              },
              {
                "type": "string",
                "const": "approval.list"
              },
              {
                "type": "string",
                "const": "approval.approve"
              },
              {
                "type": "string",
                "const": "workitem.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T81": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "dashboards"
        },
        "purpose": {
          "type": "string",
          "const": "仪表盘配置与组件数据验证"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "dashboard.list"
              },
              {
                "type": "string",
                "const": "dashboard.create"
              },
              {
                "type": "string",
                "const": "dashboard.widgets.create"
              },
              {
                "type": "string",
                "const": "dashboard.widgets.data"
              },
              {
                "type": "string",
                "const": "dashboard.get"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T82": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "portfolios"
        },
        "purpose": {
          "type": "string",
          "const": "项目组合、项目关联与汇总"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "portfolio.list"
              },
              {
                "type": "string",
                "const": "portfolio.create"
              },
              {
                "type": "string",
                "const": "portfolio.addProject"
              },
              {
                "type": "string",
                "const": "portfolio.get"
              },
              {
                "type": "string",
                "const": "portfolio.summary"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T83": {
      "type": "object",
      "properties": {
        "missingTools": {
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "workitem.transfer",
              "workitem.addCollaborator",
              "customField.setValues",
              "workflow.list",
              "workflow.addState",
              "workflow.addTransition",
              "workflow.updateTransition",
              "page.revisions",
              "import.get",
              "import.suggestions",
              "workitem.transition",
              "savedView.update",
              "automation.createRule",
              "automation.updateRule",
              "role.assign",
              "organization.assignMember",
              "workitem.link",
              "idea.vote",
              "idea.promote",
              "plan.completeIteration",
              "plan.completeRelease",
              "project.context",
              "workitem.list",
              "workitem.create",
              "workitem.children",
              "workitem.update",
              "workitem.assign",
              "workitem.get",
              "workitem.comment",
              "plan.listIterations",
              "plan.createIteration",
              "plan.getIteration",
              "plan.updateIteration",
              "plan.getRelease",
              "plan.archiveIteration",
              "plan.unarchiveIteration",
              "idea.list",
              "idea.get",
              "idea.update",
              "page.list",
              "page.get",
              "page.update",
              "page.restore",
              "automation.listRules",
              "automation.testRule",
              "automation.listRuns",
              "import.create",
              "import.setMapping",
              "import.dryRun",
              "import.confirm",
              "import.rollback",
              "intake.listForms",
              "intake.listSubmissions",
              "intake.convertSubmission",
              "project.create",
              "member.list",
              "role.list",
              "project.member.add",
              "project.members",
              "project.update",
              "project.get",
              "insight.burnDown",
              "insight.cumulativeFlow",
              "project.report",
              "workflow.states",
              "meta.workflow",
              "todo.list",
              "todo.create",
              "todo.update",
              "focus.blocks",
              "focus.createBlock",
              "focus.recordSession",
              "focus.today",
              "workitem.relations",
              "workitem.unlink",
              "workitem.collaborators",
              "workitem.transfers",
              "timeLog.create",
              "timeLog.list",
              "workitem.addProgressUpdate",
              "workitem.progressUpdates",
              "plan.addMilestoneProgressUpdate",
              "plan.milestoneDetail",
              "attachment.list",
              "attachment.upload",
              "attachment.download",
              "attachment.remove",
              "customField.definitions",
              "customField.create",
              "customField.getValues",
              "savedView.list",
              "savedView.create",
              "savedView.get",
              "savedView.reorder",
              "sla.listPolicies",
              "sla.createPolicy",
              "sla.get",
              "approval.list",
              "approval.approve",
              "dashboard.list",
              "dashboard.create",
              "dashboard.widgets.create",
              "dashboard.widgets.data",
              "dashboard.get",
              "portfolio.list",
              "portfolio.create",
              "portfolio.addProject",
              "portfolio.get",
              "portfolio.summary",
              "organization.departments",
              "organization.positions",
              "team.list",
              "role.assignments"
            ]
          }
        },
        "id": {
          "type": "string",
          "const": "organization"
        },
        "purpose": {
          "type": "string",
          "const": "组织归属、团队与角色范围管理"
        },
        "steps": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "const": "organization.departments"
              },
              {
                "type": "string",
                "const": "organization.positions"
              },
              {
                "type": "string",
                "const": "member.list"
              },
              {
                "type": "string",
                "const": "organization.assignMember"
              },
              {
                "type": "string",
                "const": "team.list"
              },
              {
                "type": "string",
                "const": "role.list"
              },
              {
                "type": "string",
                "const": "role.assignments"
              },
              {
                "type": "string",
                "const": "role.assign"
              },
              {
                "type": "string",
                "const": "role.assignments"
              }
            ]
          }
        }
      },
      "required": [
        "missingTools",
        "id",
        "purpose",
        "steps"
      ],
      "additionalProperties": false
    },
    "T84": {
      "type": "object",
      "properties": {
        "humanAuthentication": {
          "type": "string"
        },
        "systemMaintenance": {
          "type": "string"
        },
        "asynchronous": {
          "type": "string"
        },
        "protocol": {
          "type": "string"
        }
      },
      "required": [
        "humanAuthentication",
        "systemMaintenance",
        "asynchronous",
        "protocol"
      ],
      "additionalProperties": false
    },
    "T85": {
      "type": "object",
      "properties": {
        "available": {
          "type": "boolean"
        },
        "reason": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "kind": {
          "type": "string",
          "enum": [
            "read",
            "write"
          ]
        },
        "inputSchema": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "outputSchema": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      },
      "required": [
        "available",
        "reason",
        "name",
        "description",
        "kind",
        "inputSchema",
        "outputSchema"
      ],
      "additionalProperties": false
    },
    "T86": {
      "type": "object",
      "properties": {
        "group": {
          "type": "string"
        },
        "permissions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T87"
          }
        }
      },
      "required": [
        "group",
        "permissions"
      ],
      "additionalProperties": false
    },
    "T87": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "group": {
          "type": "string"
        },
        "description": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "group",
        "description"
      ],
      "additionalProperties": false
    },
    "T88": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isBuiltin": {
          "type": "boolean"
        },
        "isSystem": {
          "type": "boolean"
        },
        "permissionKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "id",
        "key",
        "name",
        "isBuiltin",
        "isSystem",
        "permissionKeys"
      ],
      "additionalProperties": false
    },
    "T89": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T90": {
      "type": "object",
      "properties": {
        "scopeType": {
          "type": "string",
          "const": "DEPARTMENT"
        },
        "scopes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T91"
          }
        }
      },
      "required": [
        "scopeType",
        "scopes"
      ],
      "additionalProperties": false
    },
    "T91": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T92": {
      "type": "object",
      "properties": {
        "scopeType": {
          "type": "string",
          "const": "TEAM"
        },
        "scopes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T93"
          }
        }
      },
      "required": [
        "scopeType",
        "scopes"
      ],
      "additionalProperties": false
    },
    "T93": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T94": {
      "type": "object",
      "properties": {
        "scopeType": {
          "type": "string",
          "const": "PROJECT"
        },
        "scopes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T95"
          }
        }
      },
      "required": [
        "scopeType",
        "scopes"
      ],
      "additionalProperties": false
    },
    "T95": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T96": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "roleId": {
          "type": "string"
        },
        "roleKey": {
          "type": "string"
        },
        "roleName": {
          "type": "string"
        },
        "roleIsBuiltin": {
          "type": "boolean"
        },
        "scopeType": {
          "type": "string",
          "enum": [
            "PROJECT",
            "TEAM",
            "DEPARTMENT",
            "ORG"
          ]
        },
        "scopeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scopeName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "memberId",
        "roleId",
        "roleKey",
        "roleName",
        "roleIsBuiltin",
        "scopeType",
        "scopeId",
        "scopeName"
      ],
      "additionalProperties": false
    },
    "T97": {
      "type": "object",
      "properties": {
        "departments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T98"
          }
        },
        "metric": {
          "type": "string"
        }
      },
      "required": [
        "departments",
        "metric"
      ],
      "additionalProperties": false
    },
    "T98": {
      "type": "object",
      "properties": {
        "memberCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "memberCount",
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T99": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "name",
        "createdAt",
        "parentId",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T100": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T101": {
      "type": "object",
      "properties": {
        "positions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T102"
          }
        }
      },
      "required": [
        "positions"
      ],
      "additionalProperties": false
    },
    "T102": {
      "type": "object",
      "properties": {
        "memberCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "code": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "departmentName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "memberCount",
        "id",
        "name",
        "code",
        "departmentId",
        "description",
        "sortOrder",
        "createdAt",
        "departmentName"
      ],
      "additionalProperties": false
    },
    "T103": {
      "type": "object",
      "properties": {
        "code": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "code",
        "id",
        "description",
        "name",
        "createdAt",
        "sortOrder",
        "archivedAt",
        "departmentId"
      ],
      "additionalProperties": false
    },
    "T104": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "code": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "code",
        "departmentId",
        "description",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T105": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "positionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "departmentId",
        "positionId"
      ],
      "additionalProperties": false
    },
    "T106": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "kind": {
          "type": "string",
          "enum": [
            "COMPANY",
            "OPC"
          ]
        },
        "departmentsCreated": {
          "type": "number"
        },
        "departmentCount": {
          "type": "integer"
        }
      },
      "required": [
        "ok",
        "kind",
        "departmentsCreated",
        "departmentCount"
      ],
      "additionalProperties": false
    },
    "T107": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "memberCount": {
          "type": "integer"
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T107"
          }
        }
      },
      "required": [
        "id",
        "name",
        "parentId",
        "sortOrder",
        "memberCount",
        "children"
      ],
      "additionalProperties": false
    },
    "T108": {
      "type": "object",
      "properties": {
        "teamIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "members": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T109"
          }
        }
      },
      "required": [
        "teamIds",
        "members"
      ],
      "additionalProperties": false
    },
    "T109": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "roles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "id",
        "name",
        "username",
        "roles"
      ],
      "additionalProperties": false
    },
    "T110": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T111": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T112": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "minutes": {
          "type": "number"
        },
        "loggedDate": {
          "type": "string"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "workItemId",
        "memberId",
        "minutes",
        "loggedDate",
        "note",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T113": {
      "type": "object",
      "properties": {
        "collaborators": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T10"
          }
        }
      },
      "required": [
        "collaborators"
      ],
      "additionalProperties": false
    },
    "T114": {
      "type": "object",
      "properties": {
        "watchers": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T14"
          }
        }
      },
      "required": [
        "watchers"
      ],
      "additionalProperties": false
    },
    "T115": {
      "type": "object",
      "properties": {
        "timeLogs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T116"
          }
        }
      },
      "required": [
        "timeLogs"
      ],
      "additionalProperties": false
    },
    "T116": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "minutes": {
          "type": "number"
        },
        "loggedDate": {
          "type": "string"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "workItemId",
        "memberId",
        "minutes",
        "loggedDate",
        "note",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T117": {
      "type": "object",
      "properties": {
        "workItemId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "memberId": {
          "type": "string"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "minutes": {
          "type": "number"
        },
        "loggedDate": {
          "type": "string"
        }
      },
      "required": [
        "workItemId",
        "id",
        "createdAt",
        "memberId",
        "note",
        "minutes",
        "loggedDate"
      ],
      "additionalProperties": false
    },
    "T118": {
      "type": "object",
      "properties": {
        "links": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T119"
          }
        }
      },
      "required": [
        "links"
      ],
      "additionalProperties": false
    },
    "T119": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "direction": {
          "type": "string"
        },
        "target": {
          "$ref": "#/$defs/T120"
        }
      },
      "required": [
        "id",
        "direction",
        "target"
      ],
      "additionalProperties": false
    },
    "T120": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "enum": [
            "WORK_ITEM",
            "MILESTONE",
            "ITERATION",
            "PAGE",
            "IDEA"
          ]
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "key": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "type",
        "id",
        "title",
        "key"
      ],
      "additionalProperties": false
    },
    "T121": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "direction": {
          "type": "string"
        },
        "target": {
          "$ref": "#/$defs/T120"
        }
      },
      "required": [
        "id",
        "direction",
        "target"
      ],
      "additionalProperties": false
    },
    "T122": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "theme": {
          "type": "string"
        },
        "locale": {
          "type": "string"
        },
        "timezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "density": {
          "type": "string"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "memberId",
        "theme",
        "locale",
        "timezone",
        "density",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T123": {
      "type": "object",
      "properties": {
        "policies": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T124"
          }
        }
      },
      "required": [
        "policies"
      ],
      "additionalProperties": false
    },
    "T124": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "enabled": {
          "type": "boolean"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "type": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "responseMinutes": {
          "type": "integer"
        },
        "resolveMinutes": {
          "type": "integer"
        },
        "escalateAfterMinutes": {
          "type": "integer"
        },
        "escalateRoles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "calendar": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "enabled",
        "priority",
        "severity",
        "type",
        "responseMinutes",
        "resolveMinutes",
        "escalateAfterMinutes",
        "escalateRoles",
        "calendar",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T125": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T126"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T126": {
      "type": "object",
      "properties": {
        "type": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "enabled": {
          "type": "boolean"
        },
        "responseMinutes": {
          "type": "integer"
        },
        "resolveMinutes": {
          "type": "integer"
        },
        "escalateAfterMinutes": {
          "type": "integer"
        },
        "escalateRoles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "calendar": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "type",
        "projectId",
        "id",
        "name",
        "createdAt",
        "updatedAt",
        "priority",
        "severity",
        "enabled",
        "responseMinutes",
        "resolveMinutes",
        "escalateAfterMinutes",
        "escalateRoles",
        "calendar"
      ],
      "additionalProperties": false
    },
    "T127": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "enabled": {
          "type": "boolean"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "type": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "responseMinutes": {
          "type": "integer"
        },
        "resolveMinutes": {
          "type": "integer"
        },
        "escalateAfterMinutes": {
          "type": "integer"
        },
        "escalateRoles": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "calendar": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "enabled",
        "priority",
        "severity",
        "type",
        "responseMinutes",
        "resolveMinutes",
        "escalateAfterMinutes",
        "escalateRoles",
        "calendar",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T128": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T129": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T130"
          }
        },
        "total": {
          "type": "integer"
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total",
        "page",
        "pageSize"
      ],
      "additionalProperties": false
    },
    "T130": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "submittedByMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "submitterDisplay": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "promotedWorkItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "score": {
          "type": "string"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "title",
        "description",
        "status",
        "submittedByMemberId",
        "submitterDisplay",
        "promotedWorkItemId",
        "score",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T131": {
      "type": "object",
      "properties": {
        "votes": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T132"
          }
        },
        "voteCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "submittedByMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "submitterDisplay": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "promotedWorkItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "score": {
          "type": "string"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "votes",
        "voteCount",
        "id",
        "projectId",
        "title",
        "description",
        "status",
        "submittedByMemberId",
        "submitterDisplay",
        "promotedWorkItemId",
        "score",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T132": {
      "type": "object",
      "properties": {
        "ideaId": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "weight": {
          "type": "number"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "ideaId",
        "memberId",
        "weight",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T133": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "submittedByMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "submitterDisplay": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "promotedWorkItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "score": {
          "type": "string"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "title",
        "description",
        "status",
        "submittedByMemberId",
        "submitterDisplay",
        "promotedWorkItemId",
        "score",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T134": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T135": {
      "type": "object",
      "properties": {
        "revisions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T47"
          }
        }
      },
      "required": [
        "revisions"
      ],
      "additionalProperties": false
    },
    "T136": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T137"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T137": {
      "type": "object",
      "properties": {
        "revisionNo": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "authorId": {
          "type": "string"
        },
        "pageId": {
          "type": "string"
        },
        "content": {
          "type": "string"
        },
        "changeSummary": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "revisionNo",
        "id",
        "createdAt",
        "authorId",
        "pageId",
        "content",
        "changeSummary"
      ],
      "additionalProperties": false
    },
    "T138": {
      "type": "object",
      "properties": {
        "permissions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T50"
          }
        }
      },
      "required": [
        "permissions"
      ],
      "additionalProperties": false
    },
    "T139": {
      "type": "object",
      "properties": {
        "permissions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T50"
          }
        }
      },
      "required": [
        "permissions"
      ],
      "additionalProperties": false
    },
    "T140": {
      "type": "object",
      "properties": {
        "attachmentId": {
          "type": "string"
        },
        "originalName": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "sizeBytes": {
          "type": "integer"
        },
        "contentBase64": {
          "type": "string"
        }
      },
      "required": [
        "attachmentId",
        "originalName",
        "mimeType",
        "sizeBytes",
        "contentBase64"
      ],
      "additionalProperties": false
    },
    "T141": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "type": "string"
        },
        "originalName": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "sizeBytes": {
          "type": "integer"
        },
        "uploaderId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "downloadPath": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "targetType",
        "targetId",
        "originalName",
        "mimeType",
        "sizeBytes",
        "uploaderId",
        "createdAt",
        "downloadPath"
      ],
      "additionalProperties": false
    },
    "T142": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "enabled": {
          "type": "boolean"
        },
        "trigger": {
          "type": "string"
        },
        "conditions": {
          "$ref": "#/$defs/JsonValue"
        },
        "actions": {
          "$ref": "#/$defs/JsonValue"
        },
        "scheduleCron": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scheduleTimezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "lastScheduledAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "scheduleState": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "enabled",
        "trigger",
        "conditions",
        "actions",
        "scheduleCron",
        "scheduleTimezone",
        "lastScheduledAt",
        "scheduleState",
        "createdBy",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T143": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T144": {
      "type": "object",
      "properties": {
        "matched": {
          "type": "boolean"
        }
      },
      "required": [
        "matched"
      ],
      "additionalProperties": false
    },
    "T145": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "categoryPrefs": {
          "$ref": "#/$defs/JsonValue"
        },
        "dndStart": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "dndEnd": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "dndTimezone": {
          "type": "string"
        },
        "digestFrequency": {
          "type": "string"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "memberId",
        "categoryPrefs",
        "dndStart",
        "dndEnd",
        "dndTimezone",
        "digestFrequency",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T146": {
      "type": "object",
      "properties": {
        "announcements": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T147"
          }
        }
      },
      "required": [
        "announcements"
      ],
      "additionalProperties": false
    },
    "T147": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "severity": {
          "type": "string"
        },
        "audience": {
          "$ref": "#/$defs/JsonValue"
        },
        "deliveredCount": {
          "type": "integer"
        },
        "revokedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "authorId",
        "title",
        "body",
        "severity",
        "audience",
        "deliveredCount",
        "revokedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T148": {
      "type": "object",
      "properties": {
        "forms": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T149"
          }
        }
      },
      "required": [
        "forms"
      ],
      "additionalProperties": false
    },
    "T149": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "schema": {
          "$ref": "#/$defs/JsonValue"
        },
        "isActive": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "schema",
        "isActive",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T150": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T151"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T151": {
      "type": "object",
      "properties": {
        "form": {
          "$ref": "#/$defs/T152"
        }
      },
      "required": [
        "form"
      ],
      "additionalProperties": false
    },
    "T152": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "schema": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "isActive": {
          "type": "boolean"
        }
      },
      "required": [
        "projectId",
        "id",
        "schema",
        "name",
        "createdAt",
        "isActive"
      ],
      "additionalProperties": false
    },
    "T153": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "schema": {
          "$ref": "#/$defs/JsonValue"
        },
        "isActive": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "schema",
        "isActive",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T154": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T155"
          }
        },
        "total": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total"
      ],
      "additionalProperties": false
    },
    "T155": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "formId": {
          "type": "string"
        },
        "payload": {
          "$ref": "#/$defs/JsonValue"
        },
        "status": {
          "type": "string"
        },
        "convertedIdeaId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "formName": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "formId",
        "payload",
        "status",
        "convertedIdeaId",
        "createdAt",
        "formName"
      ],
      "additionalProperties": false
    },
    "T156": {
      "type": "object",
      "properties": {
        "idea": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T130"
            }
          ]
        },
        "alreadyConverted": {
          "type": "boolean"
        }
      },
      "required": [
        "idea",
        "alreadyConverted"
      ],
      "additionalProperties": false
    },
    "T157": {
      "type": "object",
      "properties": {
        "idea": {
          "$ref": "#/$defs/T158"
        },
        "alreadyConverted": {
          "type": "boolean"
        }
      },
      "required": [
        "alreadyConverted"
      ],
      "additionalProperties": false
    },
    "T158": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "status": {
          "type": "string"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "submittedByMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "submitterDisplay": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "promotedWorkItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "score": {
          "type": "string"
        }
      },
      "required": [
        "projectId",
        "id",
        "title",
        "description",
        "createdAt",
        "updatedAt",
        "status",
        "deletedAt",
        "submittedByMemberId",
        "submitterDisplay",
        "promotedWorkItemId",
        "score"
      ],
      "additionalProperties": false
    },
    "T159": {
      "type": "object",
      "properties": {
        "batchId": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "totalRows": {
          "type": "number"
        },
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "sampleRows": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            }
          }
        },
        "encoding": {
          "type": "string"
        }
      },
      "required": [
        "batchId",
        "status",
        "totalRows",
        "header",
        "sampleRows",
        "encoding"
      ],
      "additionalProperties": false
    },
    "T160": {
      "type": "object",
      "properties": {
        "errorCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "filename": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "totalRows": {
          "type": "number"
        },
        "createdCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "errorCount",
        "id",
        "projectId",
        "source",
        "filename",
        "status",
        "totalRows",
        "createdCount",
        "failedCount",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T161": {
      "type": "object",
      "properties": {
        "rows": {
          "type": "array",
          "items": {
            "type": "object",
            "additionalProperties": {
              "type": "string"
            }
          }
        },
        "offset": {
          "type": "integer"
        },
        "limit": {
          "type": "integer"
        },
        "hasMore": {
          "type": "boolean"
        },
        "errorReport": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T165"
          }
        },
        "errorOffset": {
          "type": "number"
        },
        "errorLimit": {
          "type": "number"
        },
        "errorCount": {
          "type": "integer"
        },
        "errorHasMore": {
          "type": "boolean"
        },
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "fieldMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "encoding": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        },
        "preview": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/JsonValue"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "source": {
          "type": "string"
        },
        "filename": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "mappingConfig": {
          "$ref": "#/$defs/JsonValue"
        },
        "totalRows": {
          "type": "number"
        },
        "createdCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "createdBy": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "rows",
        "offset",
        "limit",
        "hasMore",
        "errorReport",
        "errorOffset",
        "errorLimit",
        "errorCount",
        "errorHasMore",
        "header",
        "fieldMap",
        "encoding",
        "preview",
        "id",
        "projectId",
        "source",
        "filename",
        "status",
        "mappingConfig",
        "totalRows",
        "createdCount",
        "failedCount",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T162": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "mapping": {
          "$ref": "#/$defs/T163"
        }
      },
      "required": [
        "ok",
        "mapping"
      ],
      "additionalProperties": false
    },
    "T163": {
      "type": "object",
      "properties": {
        "fieldMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "valueMaps": {
          "$ref": "#/$defs/JsonValue"
        },
        "userMap": {
          "type": "object",
          "additionalProperties": {
            "type": "string"
          }
        },
        "externalIdColumn": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "defaultType": {
          "type": "string"
        },
        "preview": {
          "type": "null"
        },
        "encoding": {
          "type": "string"
        },
        "hadBom": {
          "type": "boolean"
        },
        "delimiter": {
          "type": "string"
        },
        "header": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "fieldMap",
        "valueMaps",
        "userMap",
        "externalIdColumn",
        "defaultType",
        "preview"
      ],
      "additionalProperties": {
        "$ref": "#/$defs/JsonValue"
      }
    },
    "T164": {
      "type": "object",
      "properties": {
        "totalRows": {
          "type": "number"
        },
        "willCreate": {
          "type": "number"
        },
        "willSkip": {
          "type": "number"
        },
        "failed": {
          "type": "number"
        },
        "errorReport": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T165"
          }
        }
      },
      "required": [
        "totalRows",
        "willCreate",
        "willSkip",
        "failed",
        "errorReport"
      ],
      "additionalProperties": false
    },
    "T165": {
      "type": "object",
      "properties": {
        "index": {
          "type": "number"
        },
        "externalId": {
          "type": "string"
        },
        "ok": {
          "type": "boolean"
        },
        "reason": {
          "type": "string"
        },
        "code": {
          "type": "string"
        },
        "payload": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      },
      "required": [
        "index",
        "externalId",
        "ok"
      ],
      "additionalProperties": false
    },
    "T166": {
      "type": "object",
      "properties": {
        "created": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        },
        "failed": {
          "type": "number"
        },
        "status": {
          "type": "string"
        },
        "errorReport": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T165"
          }
        }
      },
      "required": [
        "created",
        "skipped",
        "failed",
        "status",
        "errorReport"
      ],
      "additionalProperties": false
    },
    "T167": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "alreadyRolledBack": {
          "type": "boolean"
        },
        "removed": {
          "type": "number"
        },
        "retainedModified": {
          "type": "number"
        },
        "retainedUnknown": {
          "type": "number"
        },
        "skippedDeleted": {
          "type": "number"
        }
      },
      "required": [
        "ok",
        "alreadyRolledBack",
        "removed",
        "retainedModified",
        "retainedUnknown",
        "skippedDeleted"
      ],
      "additionalProperties": false
    },
    "T168": {
      "type": "object",
      "properties": {
        "groups": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T169"
          }
        },
        "attentionItems": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "key": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "type": {
                "type": "string"
              },
              "priority": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "dueDate": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "version": {
                "type": "integer",
                "minimum": 1
              },
              "projectKey": {
                "type": "string"
              },
              "statusName": {
                "type": "string"
              },
              "statusKey": {
                "type": "string"
              },
              "statusCategory": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "key",
              "title",
              "type",
              "priority",
              "dueDate",
              "version",
              "projectKey",
              "statusName",
              "statusKey",
              "statusCategory"
            ],
            "additionalProperties": false
          }
        },
        "total": {
          "type": "integer"
        },
        "crossDomain": {
          "$ref": "#/$defs/T170"
        }
      },
      "required": [
        "groups",
        "attentionItems",
        "total",
        "crossDomain"
      ],
      "additionalProperties": false
    },
    "T169": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string",
          "enum": [
            "assignedToMe",
            "createdByMe",
            "overdue",
            "dueSoon"
          ]
        },
        "name": {
          "type": "string"
        },
        "items": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "key": {
                "type": "string"
              },
              "title": {
                "type": "string"
              },
              "type": {
                "type": "string"
              },
              "priority": {
                "anyOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "dueDate": {
                "anyOf": [
                  {
                    "type": "string",
                    "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
                  },
                  {
                    "type": "null"
                  }
                ]
              },
              "version": {
                "type": "integer",
                "minimum": 1
              },
              "projectKey": {
                "type": "string"
              },
              "statusName": {
                "type": "string"
              },
              "statusKey": {
                "type": "string"
              },
              "statusCategory": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "key",
              "title",
              "type",
              "priority",
              "dueDate",
              "version",
              "projectKey",
              "statusName",
              "statusKey",
              "statusCategory"
            ],
            "additionalProperties": false
          }
        },
        "count": {
          "type": "number"
        }
      },
      "required": [
        "key",
        "name",
        "items",
        "count"
      ],
      "additionalProperties": false
    },
    "T170": {
      "type": "object",
      "properties": {
        "defects": {
          "$ref": "#/$defs/T171"
        },
        "myOpenDefects": {
          "type": "number"
        },
        "milestones": {
          "$ref": "#/$defs/T172"
        }
      },
      "required": [
        "defects",
        "myOpenDefects",
        "milestones"
      ],
      "additionalProperties": false
    },
    "T171": {
      "type": "object",
      "properties": {
        "total": {
          "type": "integer"
        },
        "open": {
          "type": "number"
        },
        "p0": {
          "type": "number"
        },
        "done": {
          "type": "number"
        },
        "overdue": {
          "type": "number"
        },
        "donePercent": {
          "type": "number"
        }
      },
      "required": [
        "total",
        "open",
        "p0",
        "done",
        "overdue",
        "donePercent"
      ],
      "additionalProperties": false
    },
    "T172": {
      "type": "object",
      "properties": {
        "overdue": {
          "type": "number"
        },
        "dueSoon": {
          "type": "number"
        },
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T173"
          }
        }
      },
      "required": [
        "overdue",
        "dueSoon",
        "items"
      ],
      "additionalProperties": false
    },
    "T173": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "dueDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "projectId": {
          "type": "string"
        },
        "projectKey": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name",
        "dueDate",
        "projectId",
        "projectKey"
      ],
      "additionalProperties": false
    },
    "T174": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "done": {
          "type": "boolean"
        },
        "doneAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "memberId",
        "title",
        "dueDate",
        "done",
        "doneAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T175": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "memberId": {
          "type": "string"
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "done": {
          "type": "boolean"
        },
        "doneAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "title",
        "createdAt",
        "memberId",
        "dueDate",
        "done",
        "doneAt"
      ],
      "additionalProperties": false
    },
    "T176": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "done": {
          "type": "boolean"
        },
        "doneAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "memberId",
        "title",
        "dueDate",
        "done",
        "doneAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T177": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "startAt": {
          "type": "string",
          "format": "date-time"
        },
        "endAt": {
          "type": "string",
          "format": "date-time"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "color": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "memberId",
        "title",
        "startAt",
        "endAt",
        "projectId",
        "workItemId",
        "color",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T178": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "timeBlockId": {
          "type": "string"
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "endedAt": {
          "type": "string",
          "format": "date-time"
        },
        "actualMinutes": {
          "type": "integer"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "memberId",
        "timeBlockId",
        "startedAt",
        "endedAt",
        "actualMinutes",
        "note"
      ],
      "additionalProperties": false
    },
    "T179": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "memberId": {
          "type": "string"
        },
        "color": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startAt": {
          "type": "string",
          "format": "date-time"
        },
        "endAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "projectId",
        "workItemId",
        "id",
        "title",
        "createdAt",
        "updatedAt",
        "memberId",
        "color",
        "startAt",
        "endAt"
      ],
      "additionalProperties": false
    },
    "T180": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "startAt": {
          "type": "string",
          "format": "date-time"
        },
        "endAt": {
          "type": "string",
          "format": "date-time"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "color": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "memberId",
        "title",
        "startAt",
        "endAt",
        "projectId",
        "workItemId",
        "color",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T181": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "timeBlockId": {
          "type": "string"
        },
        "endedAt": {
          "type": "string",
          "format": "date-time"
        },
        "actualMinutes": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "memberId",
        "note",
        "startedAt",
        "timeBlockId",
        "endedAt",
        "actualMinutes"
      ],
      "additionalProperties": false
    },
    "T182": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "timeBlockId": {
          "type": "string"
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "endedAt": {
          "type": "string",
          "format": "date-time"
        },
        "actualMinutes": {
          "type": "integer"
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "memberId",
        "timeBlockId",
        "startedAt",
        "endedAt",
        "actualMinutes",
        "note"
      ],
      "additionalProperties": false
    },
    "T183": {
      "type": "object",
      "properties": {
        "day": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "blocks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T177"
          }
        },
        "sessions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T178"
          }
        },
        "plannedMinutes": {
          "type": "integer"
        },
        "focusedMinutes": {
          "type": "integer"
        },
        "sessionCount": {
          "type": "integer"
        }
      },
      "required": [
        "day",
        "blocks",
        "sessions",
        "plannedMinutes",
        "focusedMinutes",
        "sessionCount"
      ],
      "additionalProperties": false
    },
    "T184": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T185": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T186": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T187": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "memberId": {
          "type": "string"
        },
        "roleId": {
          "type": "string"
        },
        "roleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "roleName": {
          "type": "string"
        }
      },
      "required": [
        "ok",
        "memberId",
        "roleId",
        "roleIds",
        "roleName"
      ],
      "additionalProperties": false
    },
    "T188": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T189": {
      "type": "object",
      "properties": {
        "members": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T190"
          }
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        },
        "hasMore": {
          "type": "boolean"
        }
      },
      "required": [
        "members",
        "page",
        "pageSize",
        "hasMore"
      ],
      "additionalProperties": false
    },
    "T190": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "positionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "username",
        "name",
        "status",
        "departmentId",
        "positionId"
      ],
      "additionalProperties": false
    },
    "T191": {
      "type": "object",
      "properties": {
        "roles": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T88"
          }
        }
      },
      "required": [
        "roles"
      ],
      "additionalProperties": false
    },
    "T192": {
      "type": "object",
      "properties": {
        "templates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T24"
          }
        }
      },
      "required": [
        "templates"
      ],
      "additionalProperties": false
    },
    "T193": {
      "type": "object",
      "properties": {
        "iteration": {
          "$ref": "#/$defs/T194"
        },
        "metric": {
          "type": "string"
        },
        "points": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T195"
          }
        }
      },
      "required": [
        "iteration",
        "metric",
        "points"
      ],
      "additionalProperties": false
    },
    "T194": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "startDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "endDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        }
      },
      "required": [
        "id",
        "name",
        "startDate",
        "endDate"
      ],
      "additionalProperties": false
    },
    "T195": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "scope": {
          "type": "number"
        },
        "done": {
          "type": "number"
        },
        "remaining": {
          "type": "number"
        },
        "ideal": {
          "type": "number"
        },
        "source": {
          "type": "string"
        }
      },
      "required": [
        "date",
        "scope",
        "done",
        "remaining",
        "ideal",
        "source"
      ],
      "additionalProperties": false
    },
    "T196": {
      "type": "object",
      "properties": {
        "iteration": {
          "$ref": "#/$defs/T197"
        },
        "metric": {
          "type": "string"
        },
        "categories": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "series": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T198"
          }
        }
      },
      "required": [
        "iteration",
        "metric",
        "categories",
        "series"
      ],
      "additionalProperties": false
    },
    "T197": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "startDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "endDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        }
      },
      "required": [
        "id",
        "name",
        "startDate",
        "endDate"
      ],
      "additionalProperties": false
    },
    "T198": {
      "type": "object",
      "properties": {
        "total": {
          "type": "integer"
        },
        "date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "NOT_STARTED": {
          "type": "integer",
          "minimum": 0
        },
        "IN_PROGRESS": {
          "type": "integer",
          "minimum": 0
        },
        "TERMINAL": {
          "type": "integer",
          "minimum": 0
        }
      },
      "required": [
        "total",
        "date",
        "NOT_STARTED",
        "IN_PROGRESS",
        "TERMINAL"
      ],
      "additionalProperties": false
    },
    "T199": {
      "type": "object",
      "properties": {
        "metric": {
          "type": "string"
        },
        "days": {
          "type": "number"
        },
        "points": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T200"
          }
        },
        "series": {
          "$ref": "#/$defs/T201"
        }
      },
      "required": [
        "metric",
        "days",
        "points",
        "series"
      ],
      "additionalProperties": false
    },
    "T200": {
      "type": "object",
      "properties": {
        "d": {
          "type": "string"
        },
        "n": {
          "type": "number"
        }
      },
      "required": [
        "d",
        "n"
      ],
      "additionalProperties": false
    },
    "T201": {
      "type": "object",
      "properties": {
        "activity": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T202"
          }
        },
        "created": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T203"
          }
        }
      },
      "required": [
        "activity",
        "created"
      ],
      "additionalProperties": false
    },
    "T202": {
      "type": "object",
      "properties": {
        "d": {
          "type": "string"
        },
        "n": {
          "type": "number"
        }
      },
      "required": [
        "d",
        "n"
      ],
      "additionalProperties": false
    },
    "T203": {
      "type": "object",
      "properties": {
        "d": {
          "type": "string"
        },
        "n": {
          "type": "number"
        }
      },
      "required": [
        "d",
        "n"
      ],
      "additionalProperties": false
    },
    "T204": {
      "type": "object",
      "properties": {
        "dashboards": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T205"
          }
        }
      },
      "required": [
        "dashboards"
      ],
      "additionalProperties": false
    },
    "T205": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "ownerId",
        "name",
        "isDefault",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T206": {
      "type": "object",
      "properties": {
        "widgets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T207"
          }
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "widgets",
        "id",
        "projectId",
        "ownerId",
        "name",
        "isDefault",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T207": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "dashboardId": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "config": {
          "$ref": "#/$defs/JsonValue"
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "dashboardId",
        "type",
        "config",
        "sortOrder",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T208": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "isDefault": {
          "type": "boolean"
        },
        "ownerId": {
          "type": "string"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "createdAt",
        "isDefault",
        "ownerId"
      ],
      "additionalProperties": false
    },
    "T209": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "ownerId",
        "name",
        "isDefault",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T210": {
      "type": "object",
      "properties": {
        "widgets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T207"
          }
        }
      },
      "required": [
        "widgets"
      ],
      "additionalProperties": false
    },
    "T211": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "dashboardId": {
          "type": "string"
        },
        "config": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "type",
        "id",
        "createdAt",
        "sortOrder",
        "dashboardId",
        "config"
      ],
      "additionalProperties": false
    },
    "T212": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "dashboardId": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "config": {
          "$ref": "#/$defs/JsonValue"
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "dashboardId",
        "type",
        "config",
        "sortOrder",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T213": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "type": "null"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T214": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "const": "COUNT"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "$ref": "#/$defs/T215"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T215": {
      "type": "object",
      "properties": {
        "total": {
          "type": "integer"
        }
      },
      "required": [
        "total"
      ],
      "additionalProperties": false
    },
    "T216": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "const": "PIE"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "$ref": "#/$defs/T217"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T217": {
      "type": "object",
      "properties": {
        "slices": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T218"
          }
        }
      },
      "required": [
        "slices"
      ],
      "additionalProperties": false
    },
    "T218": {
      "type": "object",
      "properties": {
        "label": {
          "type": "string"
        },
        "value": {
          "type": "number"
        }
      },
      "required": [
        "label",
        "value"
      ],
      "additionalProperties": false
    },
    "T219": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "const": "LIST"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "$ref": "#/$defs/T220"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T220": {
      "type": "object",
      "properties": {
        "rows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T221"
          }
        }
      },
      "required": [
        "rows"
      ],
      "additionalProperties": false
    },
    "T221": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "key",
        "title",
        "priority"
      ],
      "additionalProperties": false
    },
    "T222": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "const": "ACTIVITY_HEATMAP"
        },
        "metric": {
          "type": "string"
        },
        "data": {
          "$ref": "#/$defs/T223"
        }
      },
      "required": [
        "type",
        "metric",
        "data"
      ],
      "additionalProperties": false
    },
    "T223": {
      "type": "object",
      "properties": {
        "cells": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T224"
          }
        }
      },
      "required": [
        "cells"
      ],
      "additionalProperties": false
    },
    "T224": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "value": {
          "type": "number"
        }
      },
      "required": [
        "date",
        "value"
      ],
      "additionalProperties": false
    },
    "T225": {
      "type": "object",
      "properties": {
        "portfolios": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T226"
          }
        }
      },
      "required": [
        "portfolios"
      ],
      "additionalProperties": false
    },
    "T226": {
      "type": "object",
      "properties": {
        "projectCount": {
          "type": "integer"
        },
        "workItemCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "projectCount",
        "workItemCount",
        "id",
        "name",
        "ownerId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T227": {
      "type": "object",
      "properties": {
        "projectCount": {
          "type": "integer"
        },
        "workItemCount": {
          "type": "integer"
        },
        "projects": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T228"
          }
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "projectCount",
        "workItemCount",
        "projects",
        "id",
        "name",
        "ownerId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T228": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T229": {
      "type": "object",
      "properties": {
        "projectCount": {
          "type": "integer"
        },
        "workItemCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "ownerId": {
          "type": "string"
        }
      },
      "required": [
        "projectCount",
        "workItemCount",
        "id",
        "name",
        "createdAt",
        "ownerId"
      ],
      "additionalProperties": false
    },
    "T230": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "ownerId",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T231": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T232": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T233": {
      "type": "object",
      "properties": {
        "portfolio": {
          "$ref": "#/$defs/T234"
        },
        "projects": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T235"
          }
        },
        "totals": {
          "$ref": "#/$defs/T238"
        },
        "risks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T239"
          }
        },
        "milestones": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T240"
          }
        },
        "activity": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T241"
          }
        }
      },
      "required": [
        "portfolio",
        "projects",
        "totals",
        "risks",
        "milestones",
        "activity"
      ],
      "additionalProperties": false
    },
    "T234": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T235": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "status": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T236"
            }
          ]
        },
        "total": {
          "type": "integer"
        },
        "done": {
          "type": "number"
        },
        "overdue": {
          "type": "number"
        },
        "progress": {
          "type": "number"
        },
        "insights": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T237"
            }
          ]
        }
      },
      "required": [
        "id",
        "key",
        "name",
        "status",
        "total",
        "done",
        "overdue",
        "progress",
        "insights"
      ],
      "additionalProperties": false
    },
    "T236": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "name",
        "category"
      ],
      "additionalProperties": false
    },
    "T237": {
      "type": "object",
      "properties": {
        "overdueMilestones": {
          "type": "number"
        },
        "overdueWorkItems": {
          "type": "number"
        },
        "urgentDefects": {
          "type": "number"
        },
        "lastActivityAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "memberCount": {
          "type": "integer"
        }
      },
      "required": [
        "overdueMilestones",
        "overdueWorkItems",
        "urgentDefects",
        "lastActivityAt",
        "memberCount"
      ],
      "additionalProperties": false
    },
    "T238": {
      "type": "object",
      "properties": {
        "projectCount": {
          "type": "integer"
        },
        "workItemCount": {
          "type": "integer"
        },
        "doneCount": {
          "type": "integer"
        },
        "overdueCount": {
          "type": "integer"
        },
        "completionPercent": {
          "type": "number"
        }
      },
      "required": [
        "projectCount",
        "workItemCount",
        "doneCount",
        "overdueCount",
        "completionPercent"
      ],
      "additionalProperties": false
    },
    "T239": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "projectName": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "count": {
          "type": "number"
        }
      },
      "required": [
        "projectId",
        "projectName",
        "type",
        "count"
      ],
      "additionalProperties": false
    },
    "T240": {
      "type": "object",
      "properties": {
        "projectName": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "projectName",
        "id",
        "projectId",
        "name",
        "dueDate",
        "completedAt",
        "archivedAt"
      ],
      "additionalProperties": false
    },
    "T241": {
      "type": "object",
      "properties": {
        "projectName": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "summary": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "projectName",
        "id",
        "projectId",
        "summary",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T242": {
      "type": "object",
      "properties": {
        "definitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T243"
          }
        }
      },
      "required": [
        "definitions"
      ],
      "additionalProperties": false
    },
    "T243": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "options": {
          "$ref": "#/$defs/JsonValue"
        },
        "requiredStates": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isRequired": {
          "type": "boolean"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "key",
        "name",
        "type",
        "options",
        "requiredStates",
        "isRequired",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T244": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "options": {
          "$ref": "#/$defs/JsonValue"
        },
        "key": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "requiredStates": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isRequired": {
          "type": "boolean"
        }
      },
      "required": [
        "type",
        "projectId",
        "options",
        "key",
        "id",
        "name",
        "createdAt",
        "sortOrder",
        "archivedAt",
        "requiredStates",
        "isRequired"
      ],
      "additionalProperties": false
    },
    "T245": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "options": {
          "$ref": "#/$defs/JsonValue"
        },
        "requiredStates": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isRequired": {
          "type": "boolean"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "key",
        "name",
        "type",
        "options",
        "requiredStates",
        "isRequired",
        "sortOrder",
        "archivedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T246": {
      "type": "object",
      "properties": {
        "filename": {
          "type": "string"
        },
        "mimeType": {
          "type": "string"
        },
        "sizeBytes": {
          "type": "integer"
        },
        "contentBase64": {
          "type": "string"
        }
      },
      "required": [
        "filename",
        "mimeType",
        "sizeBytes",
        "contentBase64"
      ],
      "additionalProperties": false
    },
    "T247": {
      "type": "object",
      "properties": {
        "mimeType": {
          "type": "string"
        },
        "schemaVersion": {
          "type": "string"
        },
        "csv": {
          "type": "string"
        },
        "count": {
          "type": "number"
        }
      },
      "required": [
        "mimeType",
        "schemaVersion",
        "csv",
        "count"
      ],
      "additionalProperties": false
    },
    "T248": {
      "type": "object",
      "properties": {
        "integrations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T249"
          }
        }
      },
      "required": [
        "integrations"
      ],
      "additionalProperties": false
    },
    "T249": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "kind": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isActive": {
          "type": "boolean"
        },
        "hasToken": {
          "type": "boolean",
          "const": true
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "kind",
        "name",
        "isActive",
        "hasToken",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T250": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "kind": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "isActive": {
          "type": "boolean"
        },
        "hasToken": {
          "type": "boolean",
          "const": true
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "kind",
        "name",
        "isActive",
        "hasToken",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T251": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T252": {
      "type": "object",
      "properties": {
        "integrationId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "isActive": {
          "type": "boolean"
        },
        "hasToken": {
          "type": "boolean",
          "const": true
        },
        "entity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "lastSyncedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "integrationId",
        "projectId",
        "isActive",
        "hasToken",
        "entity",
        "lastSyncedAt"
      ],
      "additionalProperties": false
    },
    "T253": {
      "type": "object",
      "properties": {
        "integrationId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "fetched": {
          "type": "number"
        },
        "synced": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        },
        "pulls": {
          "$ref": "#/$defs/T254"
        },
        "reviews": {
          "$ref": "#/$defs/T255"
        },
        "members": {
          "type": "number"
        }
      },
      "required": [
        "integrationId",
        "projectId",
        "fetched",
        "synced",
        "skipped",
        "pulls",
        "reviews",
        "members"
      ],
      "additionalProperties": false
    },
    "T254": {
      "type": "object",
      "properties": {
        "fetched": {
          "type": "number"
        },
        "synced": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        }
      },
      "required": [
        "fetched",
        "synced",
        "skipped"
      ],
      "additionalProperties": false
    },
    "T255": {
      "type": "object",
      "properties": {
        "fetched": {
          "type": "number"
        },
        "synced": {
          "type": "number"
        },
        "skipped": {
          "type": "number"
        }
      },
      "required": [
        "fetched",
        "synced",
        "skipped"
      ],
      "additionalProperties": false
    },
    "T256": {
      "type": "object",
      "properties": {
        "endpoints": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T257"
          }
        }
      },
      "required": [
        "endpoints"
      ],
      "additionalProperties": false
    },
    "T257": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "url": {
          "type": "string"
        },
        "events": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isActive": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "url",
        "events",
        "isActive",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T258": {
      "type": "object",
      "properties": {
        "endpoint": {
          "$ref": "#/$defs/T259"
        },
        "secret": {
          "type": "string"
        }
      },
      "required": [
        "endpoint",
        "secret"
      ],
      "additionalProperties": false
    },
    "T259": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "url": {
          "type": "string"
        },
        "isActive": {
          "type": "boolean"
        },
        "events": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "createdAt",
        "url",
        "isActive",
        "events"
      ],
      "additionalProperties": false
    },
    "T260": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "url": {
          "type": "string"
        },
        "events": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "isActive": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "url",
        "events",
        "isActive",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T261": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T262": {
      "type": "object",
      "properties": {
        "deliveries": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T263"
          }
        }
      },
      "required": [
        "deliveries"
      ],
      "additionalProperties": false
    },
    "T263": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "endpointId": {
          "type": "string"
        },
        "event": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "attempts": {
          "type": "number"
        },
        "responseCode": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "nextRetryAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "endpointId",
        "event",
        "status",
        "attempts",
        "responseCode",
        "nextRetryAt",
        "createdAt",
        "finishedAt"
      ],
      "additionalProperties": false
    },
    "T264": {
      "type": "object",
      "properties": {
        "dead": {
          "anyOf": [
            {
              "type": "boolean",
              "const": false
            },
            {
              "type": "boolean",
              "const": true
            }
          ]
        },
        "responseCode": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "attempts": {
          "type": "number"
        },
        "deliveryId": {
          "type": "string"
        },
        "endpointId": {
          "type": "string"
        },
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "deliveryId",
        "endpointId",
        "ok"
      ],
      "additionalProperties": false
    },
    "T265": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "completedAt": {
          "type": "string",
          "format": "date-time"
        },
        "targetIterationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "carriedOverCount": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "remainingCount": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "movedCount": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "movedWorkItemIds": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        }
      },
      "required": [
        "id",
        "projectId",
        "completedAt",
        "targetIterationId",
        "carriedOverCount",
        "remainingCount",
        "movedCount",
        "movedWorkItemIds"
      ],
      "additionalProperties": false
    },
    "T266": {
      "type": "object",
      "properties": {
        "parent": {
          "$ref": "#/$defs/T267"
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T268"
          }
        }
      },
      "required": [
        "parent",
        "children"
      ],
      "additionalProperties": false
    },
    "T267": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T268": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status_id": {
          "type": "string"
        },
        "statusKey": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusCategory": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "assigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "assigneeName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        }
      },
      "required": [
        "id",
        "key",
        "title",
        "type",
        "priority",
        "status_id",
        "statusKey",
        "statusName",
        "statusCategory",
        "assigneeId",
        "assigneeName",
        "dueDate"
      ],
      "additionalProperties": false
    },
    "T269": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T270": {
      "type": "object",
      "properties": {
        "blocks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T271"
          }
        },
        "blockedBy": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T272"
          }
        },
        "others": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T273"
          }
        }
      },
      "required": [
        "blocks",
        "blockedBy",
        "others"
      ],
      "additionalProperties": false
    },
    "T271": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "relatedWorkItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "workItemId",
        "relatedWorkItemId",
        "projectId",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T272": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "relatedWorkItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "workItemId",
        "relatedWorkItemId",
        "projectId",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T273": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "relatedWorkItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "type",
        "workItemId",
        "relatedWorkItemId",
        "projectId",
        "key",
        "title"
      ],
      "additionalProperties": false
    },
    "T274": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "leadMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt",
        "leadMemberId"
      ],
      "additionalProperties": false
    },
    "T275": {
      "type": "object",
      "properties": {
        "members": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T276"
          }
        }
      },
      "required": [
        "members"
      ],
      "additionalProperties": false
    },
    "T276": {
      "type": "object",
      "properties": {
        "memberId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "capacityPoints": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "capacityHours": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "loggedPoints": {
          "type": "number"
        }
      },
      "required": [
        "memberId",
        "name",
        "username",
        "capacityPoints",
        "capacityHours",
        "loggedPoints"
      ],
      "additionalProperties": false
    },
    "T277": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "capacity": {
          "$ref": "#/$defs/T278"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T278": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "memberId": {
          "type": "string"
        },
        "iterationId": {
          "type": "string"
        },
        "capacityPoints": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "capacityHours": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "loggedPoints": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "memberId",
        "iterationId",
        "capacityPoints",
        "capacityHours",
        "loggedPoints"
      ],
      "additionalProperties": false
    },
    "T279": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "scope": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "viewType": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "filters": {
          "$ref": "#/$defs/JsonValue"
        },
        "sorts": {
          "$ref": "#/$defs/JsonValue"
        },
        "isPinned": {
          "type": "boolean"
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "ownerId",
        "scope",
        "projectId",
        "viewType",
        "name",
        "filters",
        "sorts",
        "isPinned",
        "sortOrder",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T280": {
      "type": "object",
      "properties": {
        "updates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T3"
          }
        }
      },
      "required": [
        "updates"
      ],
      "additionalProperties": false
    },
    "T281": {
      "type": "object",
      "properties": {
        "milestone": {
          "$ref": "#/$defs/T282"
        },
        "project": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T283"
            }
          ]
        },
        "relatedWorkItems": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T284"
          }
        },
        "progressUpdates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T285"
          }
        }
      },
      "required": [
        "milestone",
        "project",
        "relatedWorkItems",
        "progressUpdates"
      ],
      "additionalProperties": false
    },
    "T282": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "progressMode": {
          "type": "string"
        },
        "progressValue": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "description",
        "name",
        "createdAt",
        "updatedAt",
        "sortOrder",
        "archivedAt",
        "startDate",
        "dueDate",
        "progressMode",
        "progressValue",
        "completedAt"
      ],
      "additionalProperties": false
    },
    "T283": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T284": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "statusName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusCategory": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        }
      },
      "required": [
        "id",
        "key",
        "title",
        "type",
        "statusName",
        "statusCategory",
        "priority",
        "dueDate"
      ],
      "additionalProperties": false
    },
    "T285": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "summary": {
          "type": "string"
        },
        "nextSteps": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "blockers": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "authorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "summary",
        "nextSteps",
        "blockers",
        "createdAt",
        "authorName"
      ],
      "additionalProperties": false
    },
    "T286": {
      "type": "object",
      "properties": {
        "updates": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T285"
          }
        }
      },
      "required": [
        "updates"
      ],
      "additionalProperties": false
    },
    "T287": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "milestoneId": {
          "type": "string"
        },
        "authorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "summary": {
          "type": "string"
        },
        "nextSteps": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "blockers": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "createdAt",
        "milestoneId",
        "authorId",
        "summary",
        "nextSteps",
        "blockers"
      ],
      "additionalProperties": false
    },
    "T288": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "logoUrl": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "defaultLocale": {
          "type": "string"
        },
        "defaultTimezone": {
          "type": "string"
        },
        "createdAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "updatedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "name",
        "logoUrl",
        "defaultLocale",
        "defaultTimezone",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T289": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "logoUrl": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "defaultLocale": {
          "type": "string"
        },
        "defaultTimezone": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "name",
        "logoUrl",
        "defaultLocale",
        "defaultTimezone",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T290": {
      "type": "object",
      "properties": {
        "departments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T291"
          }
        },
        "positions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T292"
          }
        }
      },
      "required": [
        "departments",
        "positions"
      ],
      "additionalProperties": false
    },
    "T291": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "children": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T291"
          }
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    },
    "T292": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string"
        },
        "dept": {
          "type": "string"
        }
      },
      "required": [
        "name"
      ],
      "additionalProperties": false
    },
    "T293": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T294": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T295": {
      "type": "object",
      "properties": {
        "teams": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T107"
          }
        }
      },
      "required": [
        "teams"
      ],
      "additionalProperties": false
    },
    "T296": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T297": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "email": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string"
        },
        "timezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "locale": {
          "type": "string"
        },
        "lastLoginAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "anonymizedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "departmentName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "positionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "positionName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "username",
        "name",
        "email",
        "status",
        "timezone",
        "locale",
        "lastLoginAt",
        "createdAt",
        "anonymizedAt",
        "departmentId",
        "departmentName",
        "positionId",
        "positionName"
      ],
      "additionalProperties": false
    },
    "T298": {
      "type": "object",
      "properties": {
        "member": {
          "$ref": "#/$defs/T299"
        },
        "assignments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T300"
          }
        },
        "permissions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "member",
        "assignments",
        "permissions"
      ],
      "additionalProperties": false
    },
    "T299": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "username",
        "name"
      ],
      "additionalProperties": false
    },
    "T300": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "scopeType": {
          "type": "string"
        },
        "scopeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "role": {
          "$ref": "#/$defs/T301"
        }
      },
      "required": [
        "id",
        "scopeType",
        "scopeId",
        "role"
      ],
      "additionalProperties": false
    },
    "T301": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T302": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T303": {
      "type": "object",
      "properties": {
        "roles": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T88"
          }
        }
      },
      "required": [
        "roles"
      ],
      "additionalProperties": false
    },
    "T304": {
      "type": "object",
      "properties": {
        "groups": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T86"
          }
        }
      },
      "required": [
        "groups"
      ],
      "additionalProperties": false
    },
    "T305": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T306": {
      "type": "object",
      "properties": {
        "assignments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T96"
          }
        }
      },
      "required": [
        "assignments"
      ],
      "additionalProperties": false
    },
    "T307": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T308": {
      "type": "object",
      "properties": {
        "products": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T309"
          }
        }
      },
      "required": [
        "products"
      ],
      "additionalProperties": false
    },
    "T309": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "version": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "canManage": {
          "type": "boolean"
        },
        "canUnlink": {
          "type": "boolean"
        },
        "requirementCount": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "name",
        "description",
        "version",
        "archivedAt",
        "createdAt",
        "updatedAt",
        "canManage",
        "canUnlink",
        "requirementCount"
      ],
      "additionalProperties": false
    },
    "T310": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "version": {
          "type": "integer"
        }
      },
      "required": [
        "ok",
        "version"
      ],
      "additionalProperties": false
    },
    "T311": {
      "type": "object",
      "properties": {
        "execution": {
          "$ref": "#/$defs/T312"
        },
        "conversation": {
          "$ref": "#/$defs/T315"
        },
        "message": {
          "$ref": "#/$defs/T316"
        }
      },
      "required": [
        "execution",
        "conversation",
        "message"
      ],
      "additionalProperties": false
    },
    "T312": {
      "type": "object",
      "properties": {
        "runId": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "CANCELLED",
            "RUNNING",
            "FAILED",
            "PARTIAL",
            "AWAITING_CONFIRMATION",
            "QUEUED",
            "WAITING_APPROVAL",
            "VERIFIED",
            "EXECUTED",
            "UNCERTAIN",
            "EXPIRED",
            "SUPERSEDED",
            "EMPTY",
            "UNAVAILABLE"
          ]
        },
        "verifiedCount": {
          "type": "integer"
        },
        "remainingCount": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "steps": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T313"
          }
        }
      },
      "required": [
        "runId",
        "status",
        "verifiedCount",
        "remainingCount",
        "createdAt",
        "updatedAt",
        "steps"
      ],
      "additionalProperties": false
    },
    "T313": {
      "type": "object",
      "properties": {
        "stepId": {
          "type": "string"
        },
        "toolName": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "CANCELLED",
            "RUNNING",
            "FAILED",
            "AWAITING_CONFIRMATION",
            "QUEUED",
            "WAITING_APPROVAL",
            "VERIFIED",
            "EXECUTED",
            "UNCERTAIN",
            "EXPIRED",
            "SUPERSEDED"
          ]
        },
        "jobId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "observedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "resources": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T314"
          }
        }
      },
      "required": [
        "stepId",
        "toolName",
        "title",
        "status",
        "jobId",
        "observedAt",
        "resources"
      ],
      "additionalProperties": false
    },
    "T314": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "milestone",
            "iteration",
            "release",
            "module",
            "comment",
            "workItem",
            "page",
            "idea"
          ]
        },
        "id": {
          "type": "string"
        }
      },
      "required": [
        "kind",
        "id"
      ],
      "additionalProperties": false
    },
    "T315": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "projectName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "available": {
          "type": "boolean"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "title",
        "projectId",
        "projectName",
        "available",
        "createdAt",
        "updatedAt",
        "deletedAt"
      ],
      "additionalProperties": false
    },
    "T316": {
      "type": "object",
      "properties": {
        "references": {
          "$ref": "#/$defs/T317"
        },
        "id": {
          "type": "string"
        },
        "conversationId": {
          "type": "string"
        },
        "requestId": {
          "type": "string"
        },
        "question": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "failed",
            "pending",
            "completed",
            "cancelled",
            "unavailable"
          ]
        },
        "reply": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T318"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "conversationId",
        "requestId",
        "question",
        "status",
        "reply",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T317": {
      "type": "object",
      "properties": {
        "artifactIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "credentialRefs": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [],
      "additionalProperties": false
    },
    "T318": {
      "type": "object",
      "properties": {
        "executionRequest": {
          "$ref": "#/$defs/T319"
        },
        "evidence": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T320"
          }
        },
        "actions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T324"
          }
        },
        "ok": {
          "type": "boolean"
        },
        "answer": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "citations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T333"
          }
        },
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword",
            "none"
          ]
        },
        "note": {
          "type": "string"
        },
        "scope": {
          "$ref": "#/$defs/T334"
        }
      },
      "required": [
        "ok",
        "answer",
        "citations",
        "mode",
        "scope"
      ],
      "additionalProperties": false
    },
    "T319": {
      "type": "object",
      "properties": {
        "origin": {
          "type": "string",
          "const": "agent"
        },
        "requestHash": {
          "type": "string"
        }
      },
      "required": [
        "origin",
        "requestHash"
      ],
      "additionalProperties": false
    },
    "T320": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "toolName": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scope": {
          "anyOf": [
            {
              "$ref": "#/$defs/T321"
            },
            {
              "$ref": "#/$defs/T322"
            }
          ]
        },
        "verificationReads": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T323"
          }
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "resources": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T314"
          }
        },
        "summary": {
          "type": "string"
        },
        "readTools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "id",
        "toolName",
        "projectId",
        "observedAt",
        "resources",
        "summary"
      ],
      "additionalProperties": false
    },
    "T321": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "project",
            "project-set"
          ]
        },
        "projectIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "kind",
        "projectIds"
      ],
      "additionalProperties": false
    },
    "T322": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "account",
            "personal"
          ]
        },
        "ownerId": {
          "type": "string"
        }
      },
      "required": [
        "kind",
        "ownerId"
      ],
      "additionalProperties": false
    },
    "T323": {
      "type": "object",
      "properties": {
        "toolName": {
          "type": "string"
        },
        "parameters": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      },
      "required": [
        "toolName",
        "parameters"
      ],
      "additionalProperties": false
    },
    "T324": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "supersedesId": {
          "type": "string"
        },
        "supersededById": {
          "type": "string"
        },
        "revisionRequest": {
          "$ref": "#/$defs/T325"
        },
        "lastFailure": {
          "$ref": "#/$defs/T326"
        },
        "toolName": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scope": {
          "anyOf": [
            {
              "$ref": "#/$defs/T321"
            },
            {
              "$ref": "#/$defs/T322"
            }
          ]
        },
        "verificationReads": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T323"
          }
        },
        "targetId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "parameters": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "expectedVersion": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "integer"
            }
          ]
        },
        "target": {
          "$ref": "#/$defs/T327"
        },
        "resources": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T314"
          }
        },
        "observations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T328"
          }
        },
        "presentation": {
          "$ref": "#/$defs/T329"
        },
        "result": {
          "$ref": "#/$defs/T331"
        },
        "status": {
          "type": "string",
          "enum": [
            "failed",
            "pending",
            "confirmed",
            "rejected",
            "expired",
            "queued",
            "running",
            "uncertain"
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "expiresAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "toolName",
        "projectId",
        "targetId",
        "parameters",
        "expectedVersion",
        "status",
        "createdAt",
        "expiresAt"
      ],
      "additionalProperties": false
    },
    "T325": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "hash": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "hash"
      ],
      "additionalProperties": false
    },
    "T326": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string"
        },
        "recordedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "code",
        "recordedAt"
      ],
      "additionalProperties": false
    },
    "T327": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "milestone",
            "iteration",
            "release",
            "module",
            "comment",
            "workItem",
            "page",
            "idea"
          ]
        },
        "id": {
          "type": "string"
        },
        "fingerprint": {
          "type": "string"
        },
        "preview": {
          "type": "object",
          "additionalProperties": {
            "anyOf": [
              {
                "type": "null"
              },
              {
                "type": "string"
              },
              {
                "type": "number"
              }
            ]
          }
        }
      },
      "required": [
        "kind",
        "id",
        "fingerprint"
      ],
      "additionalProperties": false
    },
    "T328": {
      "type": "object",
      "properties": {
        "toolName": {
          "type": "string"
        },
        "parameters": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "fingerprint": {
          "type": "string"
        }
      },
      "required": [
        "toolName",
        "parameters",
        "fingerprint"
      ],
      "additionalProperties": false
    },
    "T329": {
      "type": "object",
      "properties": {
        "title": {
          "type": "string"
        },
        "fields": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T330"
          }
        }
      },
      "required": [
        "title",
        "fields"
      ],
      "additionalProperties": false
    },
    "T330": {
      "type": "object",
      "properties": {
        "label": {
          "type": "string"
        },
        "value": {
          "type": "string"
        }
      },
      "required": [
        "label",
        "value"
      ],
      "additionalProperties": false
    },
    "T331": {
      "type": "object",
      "properties": {
        "verificationReads": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T323"
          }
        },
        "projectIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "observedAt": {
          "type": "string",
          "format": "date-time"
        },
        "resources": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T314"
          }
        },
        "value": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "outcome": {
          "type": "string",
          "const": "approval_pending"
        },
        "approval": {
          "$ref": "#/$defs/T332"
        }
      },
      "required": [
        "observedAt",
        "resources",
        "value"
      ],
      "additionalProperties": false
    },
    "T332": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "PENDING"
        }
      },
      "required": [
        "status"
      ],
      "additionalProperties": false
    },
    "T333": {
      "type": "object",
      "properties": {
        "pageId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "projectName": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "headingPath": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "snippet": {
          "type": "string"
        }
      },
      "required": [
        "pageId",
        "projectId",
        "projectName",
        "title",
        "headingPath",
        "snippet"
      ],
      "additionalProperties": false
    },
    "T334": {
      "type": "object",
      "properties": {
        "projectIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "projectCount": {
          "type": "integer"
        }
      },
      "required": [
        "projectIds",
        "projectCount"
      ],
      "additionalProperties": false
    },
    "T335": {
      "type": "object",
      "properties": {
        "conversation": {
          "$ref": "#/$defs/T315"
        },
        "message": {
          "$ref": "#/$defs/T316"
        }
      },
      "required": [
        "conversation",
        "message"
      ],
      "additionalProperties": false
    },
    "T336": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T315"
          }
        },
        "total": {
          "type": "integer"
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total",
        "page",
        "pageSize"
      ],
      "additionalProperties": false
    },
    "T337": {
      "type": "object",
      "properties": {
        "conversation": {
          "$ref": "#/$defs/T315"
        },
        "messages": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T316"
          }
        },
        "hasMore": {
          "type": "boolean"
        }
      },
      "required": [
        "conversation",
        "messages",
        "hasMore"
      ],
      "additionalProperties": false
    },
    "T338": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T339"
          }
        }
      },
      "required": [
        "items"
      ],
      "additionalProperties": false
    },
    "T339": {
      "type": "object",
      "properties": {
        "archived": {
          "anyOf": [
            {
              "type": "boolean",
              "const": false
            },
            {
              "type": "boolean",
              "const": true
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T340": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword"
          ]
        },
        "hits": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T341"
          }
        },
        "note": {
          "type": "string"
        },
        "scope": {
          "$ref": "#/$defs/T334"
        }
      },
      "required": [
        "mode",
        "hits",
        "scope"
      ],
      "additionalProperties": false
    },
    "T341": {
      "type": "object",
      "properties": {
        "chunkId": {
          "type": "string"
        },
        "directoryPath": {
          "type": "string"
        },
        "score": {
          "type": "number"
        },
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword"
          ]
        },
        "pageId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "projectName": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "headingPath": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "snippet": {
          "type": "string"
        }
      },
      "required": [
        "chunkId",
        "score",
        "mode",
        "pageId",
        "projectId",
        "projectName",
        "title",
        "headingPath",
        "snippet"
      ],
      "additionalProperties": false
    },
    "T342": {
      "type": "object",
      "properties": {
        "releaseId": {
          "type": "string"
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "candidate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T343"
            }
          ]
        },
        "passed": {
          "type": "boolean"
        },
        "checks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T345"
          }
        },
        "verification": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T346"
            }
          ]
        },
        "feedback": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T347"
          }
        }
      },
      "required": [
        "releaseId",
        "completedAt",
        "candidate",
        "passed",
        "checks",
        "verification",
        "feedback"
      ],
      "additionalProperties": false
    },
    "T343": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "releaseId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "sourceId": {
          "type": "string"
        },
        "sourceVersion": {
          "type": "integer"
        },
        "repository": {
          "type": "string"
        },
        "commitSha": {
          "type": "string"
        },
        "build": {
          "type": "string"
        },
        "environment": {
          "type": "string"
        },
        "workflowIds": {
          "type": "array",
          "items": {
            "type": "number"
          }
        },
        "testPlanIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "workItems": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T344"
          }
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "releaseId",
        "number",
        "sourceId",
        "sourceVersion",
        "repository",
        "commitSha",
        "build",
        "environment",
        "workflowIds",
        "testPlanIds",
        "workItems",
        "createdBy",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T344": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "version": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "key",
        "title",
        "version"
      ],
      "additionalProperties": false
    },
    "T345": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "passed": {
          "type": "boolean"
        },
        "message": {
          "type": "string"
        },
        "evidenceIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "testPlanId": {
          "type": "string"
        },
        "testRunIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "key",
        "passed",
        "message",
        "evidenceIds"
      ],
      "additionalProperties": false
    },
    "T346": {
      "type": "object",
      "properties": {
        "candidateId": {
          "type": "string"
        },
        "candidateNumber": {
          "type": "number"
        },
        "commitSha": {
          "type": "string"
        },
        "build": {
          "type": "string"
        },
        "environment": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        },
        "sourceVersion": {
          "type": "integer"
        },
        "repository": {
          "type": "string"
        },
        "passed": {
          "type": "boolean"
        },
        "checks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T345"
          }
        },
        "checkedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "candidateId",
        "candidateNumber",
        "commitSha",
        "build",
        "environment",
        "sourceId",
        "sourceVersion",
        "repository",
        "passed",
        "checks",
        "checkedAt"
      ],
      "additionalProperties": false
    },
    "T347": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "releaseId": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "sourceUrl": {
          "type": "string"
        },
        "conclusion": {
          "type": "string"
        },
        "outcome": {
          "type": "string",
          "enum": [
            "RESOLVED",
            "FOLLOW_UP"
          ]
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "releaseId",
        "workItemId",
        "sourceUrl",
        "conclusion",
        "outcome",
        "createdBy",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T348": {
      "type": "object",
      "properties": {
        "workItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "workItemVersion": {
          "type": "integer"
        },
        "baseRevision": {
          "$ref": "#/$defs/T349"
        },
        "impactFingerprint": {
          "type": "string"
        },
        "impacts": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T350"
          }
        },
        "canCreate": {
          "type": "boolean"
        }
      },
      "required": [
        "workItemId",
        "projectId",
        "workItemVersion",
        "baseRevision",
        "impactFingerprint",
        "impacts",
        "canCreate"
      ],
      "additionalProperties": false
    },
    "T349": {
      "type": "object",
      "properties": {
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "workItemVersion": {
          "type": "integer"
        },
        "title": {
          "type": "string"
        },
        "authorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "authorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "source": {
          "type": "string",
          "enum": [
            "INITIAL",
            "EDIT",
            "BASELINE"
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "description",
        "id",
        "workItemId",
        "revisionNo",
        "workItemVersion",
        "title",
        "authorId",
        "authorName",
        "source",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T350": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "WORK_ITEM",
            "MILESTONE",
            "ITERATION",
            "RELEASE",
            "TEST_CASE"
          ]
        },
        "targetId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "key": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sourceVersion": {
          "type": "string"
        }
      },
      "required": [
        "kind",
        "targetId",
        "title",
        "key",
        "ownerId",
        "sourceVersion"
      ],
      "additionalProperties": false
    },
    "T351": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T352"
          }
        },
        "nextCursor": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        }
      },
      "required": [
        "items",
        "nextCursor"
      ],
      "additionalProperties": false
    },
    "T352": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "status": {
          "type": "string",
          "enum": [
            "PENDING",
            "APPROVED",
            "REJECTED",
            "CANCELLED",
            "APPLIED"
          ]
        },
        "version": {
          "type": "integer"
        },
        "proposedTitle": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        },
        "requestedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "decidedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "appliedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "appliedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "id",
        "workItemId",
        "projectId",
        "number",
        "status",
        "version",
        "proposedTitle",
        "reason",
        "requestedBy",
        "createdAt",
        "decidedBy",
        "decidedAt",
        "appliedBy",
        "appliedAt"
      ],
      "additionalProperties": false
    },
    "T353": {
      "type": "object",
      "properties": {
        "baseRevision": {
          "$ref": "#/$defs/T349"
        },
        "proposedDescription": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "requestedWorkItemVersion": {
          "type": "integer"
        },
        "reviewNote": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "appliedRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "impacts": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T354"
          }
        },
        "cancelledBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "cancelledAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "cancelNote": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "participants": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T355"
          }
        },
        "canReview": {
          "type": "boolean"
        },
        "canApply": {
          "type": "boolean"
        },
        "canCancel": {
          "type": "boolean"
        },
        "stale": {
          "type": "boolean"
        },
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "status": {
          "type": "string",
          "enum": [
            "PENDING",
            "APPROVED",
            "REJECTED",
            "CANCELLED",
            "APPLIED"
          ]
        },
        "version": {
          "type": "integer"
        },
        "proposedTitle": {
          "type": "string"
        },
        "reason": {
          "type": "string"
        },
        "requestedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "decidedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "appliedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "appliedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "baseRevision",
        "proposedDescription",
        "requestedWorkItemVersion",
        "reviewNote",
        "appliedRevisionId",
        "impacts",
        "cancelledBy",
        "cancelledAt",
        "cancelNote",
        "participants",
        "canReview",
        "canApply",
        "canCancel",
        "stale",
        "id",
        "workItemId",
        "projectId",
        "number",
        "status",
        "version",
        "proposedTitle",
        "reason",
        "requestedBy",
        "createdAt",
        "decidedBy",
        "decidedAt",
        "appliedBy",
        "appliedAt"
      ],
      "additionalProperties": false
    },
    "T354": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "acknowledgedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "acknowledgedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "note": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "canAcknowledge": {
          "type": "boolean"
        },
        "available": {
          "type": "boolean"
        },
        "kind": {
          "type": "string",
          "enum": [
            "WORK_ITEM",
            "MILESTONE",
            "ITERATION",
            "RELEASE",
            "TEST_CASE"
          ]
        },
        "targetId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "key": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sourceVersion": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "acknowledgedBy",
        "acknowledgedAt",
        "note",
        "canAcknowledge",
        "available",
        "kind",
        "targetId",
        "title",
        "key",
        "ownerId",
        "sourceVersion"
      ],
      "additionalProperties": false
    },
    "T355": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T356": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T357"
          }
        },
        "nextCursor": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "canManage": {
          "type": "boolean"
        }
      },
      "required": [
        "items",
        "nextCursor",
        "canManage"
      ],
      "additionalProperties": false
    },
    "T357": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "build": {
          "type": "string"
        },
        "environment": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "CANCELLED",
            "DRAFT",
            "RUNNING",
            "COMPLETED"
          ]
        },
        "version": {
          "type": "integer"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "cancelReason": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "canManage": {
          "type": "boolean"
        },
        "canExecute": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "projectId",
        "number",
        "key",
        "title",
        "build",
        "environment",
        "status",
        "version",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt",
        "cancelReason",
        "canManage",
        "canExecute"
      ],
      "additionalProperties": false
    },
    "T358": {
      "type": "object",
      "properties": {
        "cases": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T359"
          }
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "build": {
          "type": "string"
        },
        "environment": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "CANCELLED",
            "DRAFT",
            "RUNNING",
            "COMPLETED"
          ]
        },
        "version": {
          "type": "integer"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "startedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "cancelReason": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "canManage": {
          "type": "boolean"
        },
        "canExecute": {
          "type": "boolean"
        }
      },
      "required": [
        "cases",
        "id",
        "projectId",
        "number",
        "key",
        "title",
        "build",
        "environment",
        "status",
        "version",
        "createdBy",
        "createdAt",
        "startedAt",
        "finishedAt",
        "cancelReason",
        "canManage",
        "canExecute"
      ],
      "additionalProperties": false
    },
    "T359": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "caseId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "title": {
          "type": "string"
        },
        "position": {
          "type": "number"
        },
        "latestRun": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T360"
            }
          ]
        }
      },
      "required": [
        "id",
        "caseId",
        "key",
        "revisionId",
        "revisionNo",
        "title",
        "position",
        "latestRun"
      ],
      "additionalProperties": false
    },
    "T360": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "CANCELLED",
            "IN_PROGRESS",
            "PASSED",
            "FAILED",
            "BLOCKED",
            "SKIPPED"
          ]
        },
        "attempt": {
          "type": "number"
        }
      },
      "required": [
        "id",
        "status",
        "attempt"
      ],
      "additionalProperties": false
    },
    "T361": {
      "type": "object",
      "properties": {
        "plan": {
          "$ref": "#/$defs/T357"
        },
        "totalCases": {
          "type": "number"
        },
        "totalAttempts": {
          "type": "number"
        },
        "latestResults": {
          "$ref": "#/$defs/T362"
        },
        "allAttempts": {
          "$ref": "#/$defs/T363"
        },
        "passed": {
          "type": "boolean"
        },
        "testedBuild": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "testedEnvironment": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "cases": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T364"
          }
        },
        "generatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "plan",
        "totalCases",
        "totalAttempts",
        "latestResults",
        "allAttempts",
        "passed",
        "testedBuild",
        "testedEnvironment",
        "cases",
        "generatedAt"
      ],
      "additionalProperties": false
    },
    "T362": {
      "type": "object",
      "properties": {
        "CANCELLED": {
          "type": "number"
        },
        "IN_PROGRESS": {
          "type": "number"
        },
        "PASSED": {
          "type": "number"
        },
        "FAILED": {
          "type": "number"
        },
        "BLOCKED": {
          "type": "number"
        },
        "SKIPPED": {
          "type": "number"
        },
        "NOT_RUN": {
          "type": "number"
        }
      },
      "required": [
        "CANCELLED",
        "IN_PROGRESS",
        "PASSED",
        "FAILED",
        "BLOCKED",
        "SKIPPED",
        "NOT_RUN"
      ],
      "additionalProperties": false
    },
    "T363": {
      "type": "object",
      "properties": {
        "CANCELLED": {
          "type": "number"
        },
        "IN_PROGRESS": {
          "type": "number"
        },
        "PASSED": {
          "type": "number"
        },
        "FAILED": {
          "type": "number"
        },
        "BLOCKED": {
          "type": "number"
        },
        "SKIPPED": {
          "type": "number"
        }
      },
      "required": [
        "CANCELLED",
        "IN_PROGRESS",
        "PASSED",
        "FAILED",
        "BLOCKED",
        "SKIPPED"
      ],
      "additionalProperties": false
    },
    "T364": {
      "type": "object",
      "properties": {
        "planCaseId": {
          "type": "string"
        },
        "caseId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "latestStatus": {
          "type": "string",
          "enum": [
            "CANCELLED",
            "IN_PROGRESS",
            "PASSED",
            "FAILED",
            "BLOCKED",
            "SKIPPED",
            "NOT_RUN"
          ]
        },
        "runs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T365"
          }
        }
      },
      "required": [
        "planCaseId",
        "caseId",
        "key",
        "title",
        "revisionId",
        "revisionNo",
        "latestStatus",
        "runs"
      ],
      "additionalProperties": false
    },
    "T365": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "planId": {
          "type": "string"
        },
        "planCaseId": {
          "type": "string"
        },
        "caseId": {
          "type": "string"
        },
        "caseKey": {
          "type": "string"
        },
        "planTitle": {
          "type": "string"
        },
        "build": {
          "type": "string"
        },
        "environment": {
          "type": "string"
        },
        "attempt": {
          "type": "number"
        },
        "retestOf": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "type": "string",
          "enum": [
            "CANCELLED",
            "IN_PROGRESS",
            "PASSED",
            "FAILED",
            "BLOCKED",
            "SKIPPED"
          ]
        },
        "version": {
          "type": "integer"
        },
        "source": {
          "type": "string",
          "enum": [
            "MANUAL",
            "AGENT",
            "AUTOMATION"
          ]
        },
        "sourceReference": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sourceVerification": {
          "type": "string",
          "const": "SELF_REPORTED"
        },
        "executorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "executorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "finishedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "cancelReason": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "results": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T366"
          }
        },
        "revision": {
          "$ref": "#/$defs/T367"
        },
        "defects": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T370"
          }
        },
        "canExecute": {
          "type": "boolean"
        },
        "canRetest": {
          "type": "boolean"
        },
        "canCreateDefect": {
          "type": "boolean"
        },
        "canLinkDefect": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "projectId",
        "planId",
        "planCaseId",
        "caseId",
        "caseKey",
        "planTitle",
        "build",
        "environment",
        "attempt",
        "retestOf",
        "status",
        "version",
        "source",
        "sourceReference",
        "sourceVerification",
        "executorId",
        "executorName",
        "startedAt",
        "finishedAt",
        "cancelReason",
        "results",
        "revision",
        "defects",
        "canExecute",
        "canRetest",
        "canCreateDefect",
        "canLinkDefect"
      ],
      "additionalProperties": false
    },
    "T366": {
      "type": "object",
      "properties": {
        "stepIndex": {
          "type": "number"
        },
        "status": {
          "type": "string",
          "enum": [
            "PASSED",
            "FAILED",
            "BLOCKED",
            "SKIPPED"
          ]
        },
        "actual": {
          "type": "string"
        },
        "evidence": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "stepIndex",
        "status",
        "actual",
        "evidence"
      ],
      "additionalProperties": false
    },
    "T367": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "caseId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "title": {
          "type": "string"
        },
        "preconditions": {
          "type": "string"
        },
        "steps": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T368"
          }
        },
        "requirements": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T369"
          }
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "authorName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "caseId",
        "revisionNo",
        "title",
        "preconditions",
        "steps",
        "requirements",
        "createdBy",
        "authorName",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T368": {
      "type": "object",
      "properties": {
        "action": {
          "type": "string"
        },
        "expected": {
          "type": "string"
        }
      },
      "required": [
        "action",
        "expected"
      ],
      "additionalProperties": false
    },
    "T369": {
      "type": "object",
      "properties": {
        "workItemId": {
          "type": "string"
        },
        "revisionId": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        }
      },
      "required": [
        "workItemId",
        "revisionId",
        "key",
        "title",
        "revisionNo"
      ],
      "additionalProperties": false
    },
    "T370": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "statusKey": {
          "type": "string"
        },
        "statusName": {
          "type": "string"
        },
        "statusCategory": {
          "type": "string"
        },
        "generated": {
          "type": "boolean"
        },
        "inherited": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "key",
        "title",
        "statusKey",
        "statusName",
        "statusCategory",
        "generated",
        "inherited"
      ],
      "additionalProperties": false
    },
    "T371": {
      "type": "object",
      "properties": {
        "runId": {
          "type": "string"
        },
        "defect": {
          "$ref": "#/$defs/T372"
        }
      },
      "required": [
        "runId",
        "defect"
      ],
      "additionalProperties": false
    },
    "T372": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "key",
        "title",
        "type",
        "projectId"
      ],
      "additionalProperties": false
    },
    "T373": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T374"
          }
        },
        "canManage": {
          "type": "boolean"
        }
      },
      "required": [
        "items",
        "canManage"
      ],
      "additionalProperties": false
    },
    "T374": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "type": "string"
        },
        "version": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "activeCaseCount": {
          "type": "integer"
        },
        "canManage": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "description",
        "version",
        "archivedAt",
        "activeCaseCount",
        "canManage"
      ],
      "additionalProperties": false
    },
    "T375": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T376"
          }
        },
        "nextCursor": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        },
        "canManage": {
          "type": "boolean"
        }
      },
      "required": [
        "items",
        "nextCursor",
        "canManage"
      ],
      "additionalProperties": false
    },
    "T376": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "DRAFT",
            "READY",
            "ARCHIVED"
          ]
        },
        "priority": {
          "type": "string",
          "enum": [
            "LOWEST",
            "LOW",
            "MEDIUM",
            "HIGH",
            "URGENT"
          ]
        },
        "version": {
          "type": "integer"
        },
        "currentRevisionId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "suiteId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "suiteName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "canManage": {
          "type": "boolean"
        }
      },
      "required": [
        "id",
        "projectId",
        "number",
        "key",
        "title",
        "status",
        "priority",
        "version",
        "currentRevisionId",
        "revisionNo",
        "suiteId",
        "suiteName",
        "ownerId",
        "ownerName",
        "updatedAt",
        "canManage"
      ],
      "additionalProperties": false
    },
    "T377": {
      "type": "object",
      "properties": {
        "revision": {
          "$ref": "#/$defs/T367"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "key": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "status": {
          "type": "string",
          "enum": [
            "DRAFT",
            "READY",
            "ARCHIVED"
          ]
        },
        "priority": {
          "type": "string",
          "enum": [
            "LOWEST",
            "LOW",
            "MEDIUM",
            "HIGH",
            "URGENT"
          ]
        },
        "version": {
          "type": "integer"
        },
        "currentRevisionId": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "suiteId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "suiteName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "ownerName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "canManage": {
          "type": "boolean"
        }
      },
      "required": [
        "revision",
        "id",
        "projectId",
        "number",
        "key",
        "title",
        "status",
        "priority",
        "version",
        "currentRevisionId",
        "revisionNo",
        "suiteId",
        "suiteName",
        "ownerId",
        "ownerName",
        "updatedAt",
        "canManage"
      ],
      "additionalProperties": false
    },
    "T378": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T379"
          }
        },
        "nextCursor": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "number"
            }
          ]
        }
      },
      "required": [
        "items",
        "nextCursor"
      ],
      "additionalProperties": false
    },
    "T379": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "revisionNo",
        "title",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T380": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "server": {
          "type": "string"
        }
      },
      "required": [
        "ok",
        "server"
      ],
      "additionalProperties": false
    },
    "T381": {
      "type": "object",
      "properties": {
        "roomId": {
          "type": "string"
        },
        "resourceType": {
          "type": "string"
        },
        "resourceId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "mode": {
          "type": "string"
        },
        "baseRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sequence": {
          "type": "number"
        },
        "canWrite": {
          "type": "boolean"
        },
        "rag": {
          "$ref": "#/$defs/T382"
        },
        "actions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "domainTools": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "domainAuthorization": {
          "type": "string"
        }
      },
      "required": [
        "roomId",
        "resourceType",
        "resourceId",
        "projectId",
        "mode",
        "baseRevisionId",
        "sequence",
        "canWrite",
        "rag",
        "actions",
        "domainTools",
        "domainAuthorization"
      ],
      "additionalProperties": false
    },
    "T382": {
      "type": "object",
      "properties": {
        "source": {
          "type": "string"
        },
        "publishedRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "source",
        "publishedRevisionId"
      ],
      "additionalProperties": false
    },
    "T383": {
      "type": "object",
      "properties": {
        "member": {
          "$ref": "#/$defs/T384"
        },
        "tokenTier": {
          "type": "string",
          "enum": [
            "READ_ONLY",
            "READ_WRITE",
            "ADMIN"
          ]
        },
        "projectWhitelist": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "permissions": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "timezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "locale": {
          "type": "string"
        },
        "visibleProjects": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string"
              },
              "key": {
                "type": "string"
              },
              "name": {
                "type": "string"
              }
            },
            "required": [
              "id",
              "key",
              "name"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "member",
        "tokenTier",
        "projectWhitelist",
        "permissions",
        "timezone",
        "locale",
        "visibleProjects"
      ],
      "additionalProperties": false
    },
    "T384": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "username",
        "name"
      ],
      "additionalProperties": false
    },
    "T385": {
      "type": "object",
      "properties": {
        "id": {
          "$ref": "#/$defs/JsonValue"
        },
        "key": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "id",
        "key",
        "name"
      ],
      "additionalProperties": false
    },
    "T386": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T387"
          }
        },
        "total": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total"
      ],
      "additionalProperties": false
    },
    "T387": {
      "type": "object",
      "properties": {
        "id": {
          "$ref": "#/$defs/JsonValue"
        },
        "key": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "$ref": "#/$defs/JsonValue"
        },
        "status": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T388"
            }
          ]
        },
        "workItemCount": {
          "type": "integer"
        }
      },
      "required": [
        "id",
        "key",
        "name",
        "status",
        "workItemCount"
      ],
      "additionalProperties": false
    },
    "T388": {
      "type": "object",
      "properties": {
        "key": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "$ref": "#/$defs/JsonValue"
        },
        "category": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "key",
        "name",
        "category"
      ],
      "additionalProperties": false
    },
    "T389": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "leadMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "status": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T390"
            }
          ]
        },
        "departmentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "department": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T391"
            }
          ]
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "statusDefs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T392"
          }
        },
        "workflows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T393"
          }
        }
      },
      "required": [
        "id",
        "key",
        "name",
        "description",
        "leadMemberId",
        "status",
        "departmentId",
        "department",
        "archivedAt",
        "createdAt",
        "updatedAt",
        "statusDefs",
        "workflows"
      ],
      "additionalProperties": false
    },
    "T390": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "color"
      ],
      "additionalProperties": false
    },
    "T391": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        }
      },
      "required": [
        "id",
        "name"
      ],
      "additionalProperties": false
    },
    "T392": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "color"
      ],
      "additionalProperties": false
    },
    "T393": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "states": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T394"
          }
        }
      },
      "required": [
        "id",
        "name",
        "appliesToType",
        "isDefault",
        "states"
      ],
      "additionalProperties": false
    },
    "T394": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "color"
      ],
      "additionalProperties": false
    },
    "T395": {
      "type": "object",
      "properties": {
        "members": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T396"
          }
        }
      },
      "required": [
        "members"
      ],
      "additionalProperties": false
    },
    "T396": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "username": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "role_key": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "role_name": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "username",
        "name",
        "role_key",
        "role_name"
      ],
      "additionalProperties": false
    },
    "T397": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T398"
          }
        },
        "total": {
          "type": "integer"
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total",
        "page",
        "pageSize"
      ],
      "additionalProperties": false
    },
    "T398": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "key": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "title": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "assigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusId": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "statusKey": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusCategory": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "version": {
          "type": "integer"
        },
        "milestoneId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "iterationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "moduleId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "id",
        "key",
        "number",
        "title",
        "type",
        "priority",
        "severity",
        "assigneeId",
        "statusId",
        "projectId",
        "workflowId",
        "statusKey",
        "statusName",
        "statusCategory",
        "startDate",
        "dueDate",
        "createdAt",
        "updatedAt",
        "version",
        "milestoneId",
        "iterationId",
        "releaseId",
        "moduleId"
      ],
      "additionalProperties": false
    },
    "T399": {
      "type": "object",
      "properties": {
        "workItem": {
          "$ref": "#/$defs/T400"
        },
        "allowedTransitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T401"
          }
        }
      },
      "required": [
        "workItem",
        "allowedTransitions"
      ],
      "additionalProperties": false
    },
    "T400": {
      "type": "object",
      "properties": {
        "statusKey": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "statusCategory": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "number": {
          "type": "integer"
        },
        "key": {
          "type": "string"
        },
        "type": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "workflowId": {
          "type": "string"
        },
        "statusId": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "milestoneId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "iterationId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "moduleId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "productId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "assigneeId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "reporterId": {
          "type": "string"
        },
        "priority": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "severity": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "estimatePoints": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "estimateHours": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "version": {
          "type": "integer"
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "statusKey",
        "statusName",
        "statusCategory",
        "id",
        "projectId",
        "number",
        "key",
        "type",
        "title",
        "description",
        "workflowId",
        "statusId",
        "parentId",
        "milestoneId",
        "iterationId",
        "releaseId",
        "moduleId",
        "productId",
        "assigneeId",
        "reporterId",
        "priority",
        "severity",
        "estimatePoints",
        "estimateHours",
        "startDate",
        "dueDate",
        "completedAt",
        "version",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T401": {
      "type": "object",
      "properties": {
        "toStateKey": {
          "type": "string"
        },
        "toName": {
          "type": "string"
        },
        "toCategory": {
          "type": "string"
        },
        "label": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "toStateKey",
        "toName",
        "toCategory",
        "label",
        "requiredFields"
      ],
      "additionalProperties": false
    },
    "T402": {
      "type": "object",
      "properties": {
        "comments": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T18"
          }
        }
      },
      "required": [
        "comments"
      ],
      "additionalProperties": false
    },
    "T403": {
      "type": "object",
      "properties": {
        "milestones": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T404"
          }
        }
      },
      "required": [
        "milestones"
      ],
      "additionalProperties": false
    },
    "T404": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "description": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "startDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "dueDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "progressMode": {
          "type": "string"
        },
        "progressValue": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "description",
        "name",
        "createdAt",
        "updatedAt",
        "sortOrder",
        "archivedAt",
        "startDate",
        "dueDate",
        "progressMode",
        "progressValue",
        "completedAt"
      ],
      "additionalProperties": false
    },
    "T405": {
      "type": "object",
      "properties": {
        "milestone": {
          "$ref": "#/$defs/T282"
        },
        "workItems": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T398"
          }
        }
      },
      "required": [
        "milestone",
        "workItems"
      ],
      "additionalProperties": false
    },
    "T406": {
      "type": "object",
      "properties": {
        "iterations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T407"
          }
        }
      },
      "required": [
        "iterations"
      ],
      "additionalProperties": false
    },
    "T407": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "startDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "endDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "completionResult": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T265"
            }
          ]
        },
        "carryOver": {
          "type": "boolean"
        },
        "pendingWorkItemCount": {
          "type": "integer"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "startDate",
        "completedAt",
        "endDate",
        "completionResult",
        "carryOver",
        "pendingWorkItemCount"
      ],
      "additionalProperties": false
    },
    "T408": {
      "type": "object",
      "properties": {
        "releases": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T409"
          }
        }
      },
      "required": [
        "releases"
      ],
      "additionalProperties": false
    },
    "T409": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "completionResult": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T265"
            }
          ]
        },
        "versionTag": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "notes": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "pendingWorkItemCount": {
          "type": "integer"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "completedAt",
        "completionResult",
        "versionTag",
        "releaseDate",
        "notes",
        "pendingWorkItemCount"
      ],
      "additionalProperties": false
    },
    "T410": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T411"
          }
        },
        "unreadCount": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "unreadCount"
      ],
      "additionalProperties": false
    },
    "T411": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "recipientId": {
          "type": "string"
        },
        "actorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "type": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "link": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "readAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "groupKey": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "itemCount": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "recipientId",
        "actorId",
        "type",
        "category",
        "title",
        "body",
        "link",
        "readAt",
        "groupKey",
        "itemCount",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T412": {
      "type": "object",
      "properties": {
        "items": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T413"
          }
        },
        "total": {
          "type": "integer"
        },
        "page": {
          "type": "integer"
        },
        "pageSize": {
          "type": "integer"
        }
      },
      "required": [
        "items",
        "total",
        "page",
        "pageSize"
      ],
      "additionalProperties": false
    },
    "T413": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "actorId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "action": {
          "type": "string"
        },
        "summary": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "actorId",
        "targetType",
        "targetId",
        "action",
        "summary",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T414": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "workflows": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T415"
          }
        }
      },
      "required": [
        "projectId",
        "workflows"
      ],
      "additionalProperties": false
    },
    "T415": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "appliesToType": {
          "type": "string"
        },
        "isDefault": {
          "type": "boolean"
        },
        "states": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T416"
          }
        },
        "transitions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T417"
          }
        }
      },
      "required": [
        "id",
        "name",
        "appliesToType",
        "isDefault",
        "states",
        "transitions"
      ],
      "additionalProperties": false
    },
    "T416": {
      "type": "object",
      "properties": {
        "key": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "category": {
          "type": "string"
        },
        "color": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        }
      },
      "required": [
        "key",
        "name",
        "category",
        "color",
        "sortOrder"
      ],
      "additionalProperties": false
    },
    "T417": {
      "type": "object",
      "properties": {
        "from": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "to": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "allowedRoleIds": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "requiredFields": {
          "type": "array",
          "items": {
            "type": "string"
          }
        }
      },
      "required": [
        "from",
        "to",
        "allowedRoleIds",
        "requiredFields"
      ],
      "additionalProperties": false
    },
    "T418": {
      "type": "object",
      "properties": {
        "pages": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T419"
          }
        }
      },
      "required": [
        "pages"
      ],
      "additionalProperties": false
    },
    "T419": {
      "type": "object",
      "properties": {
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "slug": {
          "type": "string"
        },
        "visibility": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "currentRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "kind": {
          "type": "string"
        },
        "structureVersion": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "isArchived": {
          "type": "boolean"
        }
      },
      "required": [
        "parentId",
        "id",
        "title",
        "slug",
        "visibility",
        "sortOrder",
        "currentRevisionId",
        "updatedAt",
        "kind",
        "structureVersion",
        "archivedAt",
        "isArchived"
      ],
      "additionalProperties": false
    },
    "T420": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "changeSummary": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "isArchived": {
          "type": "boolean"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "slug": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "kind": {
          "type": "string"
        },
        "structureVersion": {
          "type": "integer"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "visibility": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "searchVector": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "currentRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "content",
        "revisionNo",
        "changeSummary",
        "isArchived",
        "id",
        "projectId",
        "title",
        "slug",
        "parentId",
        "kind",
        "structureVersion",
        "createdBy",
        "archivedAt",
        "visibility",
        "sortOrder",
        "searchVector",
        "currentRevisionId",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T421": {
      "type": "object",
      "properties": {
        "mode": {
          "type": "string"
        },
        "hits": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T422"
          }
        },
        "note": {
          "type": "string"
        }
      },
      "required": [
        "mode",
        "hits"
      ],
      "additionalProperties": false
    },
    "T422": {
      "type": "object",
      "properties": {
        "chunkId": {
          "type": "string"
        },
        "pageId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "directoryPath": {
          "type": "string"
        },
        "headingPath": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "snippet": {
          "type": "string"
        },
        "score": {
          "type": "number"
        },
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword"
          ]
        }
      },
      "required": [
        "chunkId",
        "pageId",
        "title",
        "headingPath",
        "snippet",
        "score",
        "mode"
      ],
      "additionalProperties": false
    },
    "T423": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "answer": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "citations": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T424"
          }
        },
        "mode": {
          "type": "string",
          "enum": [
            "vector",
            "keyword",
            "none"
          ]
        },
        "note": {
          "type": "string"
        }
      },
      "required": [
        "ok",
        "answer",
        "citations",
        "mode"
      ],
      "additionalProperties": false
    },
    "T424": {
      "type": "object",
      "properties": {
        "pageId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "headingPath": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "snippet": {
          "type": "string"
        }
      },
      "required": [
        "pageId",
        "title",
        "headingPath",
        "snippet"
      ],
      "additionalProperties": false
    },
    "T425": {
      "type": "object",
      "properties": {
        "fields": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T426"
          }
        },
        "schemas": {
          "$ref": "#/$defs/T427"
        },
        "note": {
          "type": "string"
        }
      },
      "required": [
        "fields",
        "schemas",
        "note"
      ],
      "additionalProperties": false
    },
    "T426": {
      "type": "object",
      "properties": {
        "note": {
          "type": "string"
        },
        "required": {
          "type": "boolean"
        },
        "nullable": {
          "type": "boolean"
        },
        "schema": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "maxLength": {
          "type": "integer",
          "minimum": 1
        },
        "values": {
          "$ref": "#/$defs/JsonValue"
        },
        "name": {
          "type": "string"
        },
        "type": {
          "anyOf": [
            {
              "type": "string"
            },
            {
              "type": "array",
              "items": {
                "type": "string"
              }
            }
          ]
        }
      },
      "required": [
        "required",
        "nullable",
        "schema",
        "name",
        "type"
      ],
      "additionalProperties": false
    },
    "T427": {
      "type": "object",
      "properties": {
        "create": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "update": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        }
      },
      "required": [
        "create",
        "update"
      ],
      "additionalProperties": false
    },
    "T428": {
      "type": "object",
      "properties": {
        "sla": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T429"
            }
          ]
        }
      },
      "required": [
        "sla"
      ],
      "additionalProperties": false
    },
    "T429": {
      "type": "object",
      "properties": {
        "policy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T124"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "policyId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "firstResponseAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "responseDueAt": {
          "type": "string",
          "format": "date-time"
        },
        "resolveDueAt": {
          "type": "string",
          "format": "date-time"
        },
        "breachedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "state": {
          "type": "string"
        },
        "pausedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "pausedMs": {
          "type": "integer"
        },
        "lastEscalatedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "policy",
        "id",
        "workItemId",
        "policyId",
        "startedAt",
        "firstResponseAt",
        "responseDueAt",
        "resolveDueAt",
        "breachedAt",
        "state",
        "pausedAt",
        "pausedMs",
        "lastEscalatedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T430": {
      "type": "object",
      "properties": {
        "approvals": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T431"
          }
        }
      },
      "required": [
        "approvals"
      ],
      "additionalProperties": false
    },
    "T431": {
      "type": "object",
      "properties": {
        "fromStateName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "toStateName": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "requestedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "transitionFields": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "status": {
          "type": "string"
        },
        "comment": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "fromStateName",
        "toStateName",
        "id",
        "workItemId",
        "workflowId",
        "fromStateId",
        "toStateId",
        "requestedBy",
        "approverRoleKeys",
        "transitionFields",
        "status",
        "comment",
        "decidedBy",
        "decidedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T432": {
      "type": "object",
      "properties": {
        "rules": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T433"
          }
        }
      },
      "required": [
        "rules"
      ],
      "additionalProperties": false
    },
    "T433": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "enabled": {
          "type": "boolean"
        },
        "trigger": {
          "type": "string"
        },
        "conditions": {
          "$ref": "#/$defs/JsonValue"
        },
        "actions": {
          "$ref": "#/$defs/JsonValue"
        },
        "scheduleCron": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scheduleTimezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "lastScheduledAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "scheduleState": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "projectId",
        "name",
        "enabled",
        "trigger",
        "conditions",
        "actions",
        "scheduleCron",
        "scheduleTimezone",
        "lastScheduledAt",
        "scheduleState",
        "createdBy",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T434": {
      "type": "object",
      "properties": {
        "runs": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T435"
          }
        }
      },
      "required": [
        "runs"
      ],
      "additionalProperties": false
    },
    "T435": {
      "type": "object",
      "properties": {
        "run": {
          "$ref": "#/$defs/T436"
        },
        "ruleName": {
          "type": "string"
        }
      },
      "required": [
        "run",
        "ruleName"
      ],
      "additionalProperties": false
    },
    "T436": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "ruleId": {
          "type": "string"
        },
        "workItemId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "trigger": {
          "type": "string"
        },
        "status": {
          "type": "string"
        },
        "actions": {
          "$ref": "#/$defs/JsonValue"
        },
        "error": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "ruleId",
        "workItemId",
        "trigger",
        "status",
        "actions",
        "error",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T437": {
      "type": "object",
      "properties": {
        "portfolios": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T226"
          }
        }
      },
      "required": [
        "portfolios"
      ],
      "additionalProperties": false
    },
    "T438": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T439": {
      "type": "object",
      "properties": {
        "forms": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T149"
          }
        }
      },
      "required": [
        "forms"
      ],
      "additionalProperties": false
    },
    "T440": {
      "type": "object",
      "properties": {
        "form": {
          "$ref": "#/$defs/T152"
        },
        "submitToken": {
          "type": "string"
        }
      },
      "required": [
        "form",
        "submitToken"
      ],
      "additionalProperties": false
    },
    "T441": {
      "type": "object",
      "properties": {
        "submitToken": {
          "type": "string"
        }
      },
      "required": [
        "submitToken"
      ],
      "additionalProperties": false
    },
    "T442": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T443": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T444": {
      "type": "object",
      "properties": {
        "todos": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T174"
          }
        }
      },
      "required": [
        "todos"
      ],
      "additionalProperties": false
    },
    "T445": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T446": {
      "type": "object",
      "properties": {
        "blocks": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T177"
          }
        }
      },
      "required": [
        "blocks"
      ],
      "additionalProperties": false
    },
    "T447": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T448": {
      "type": "object",
      "properties": {
        "sessions": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T178"
          }
        }
      },
      "required": [
        "sessions"
      ],
      "additionalProperties": false
    },
    "T449": {
      "type": "object",
      "properties": {
        "views": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T279"
          }
        }
      },
      "required": [
        "views"
      ],
      "additionalProperties": false
    },
    "T450": {
      "type": "object",
      "properties": {
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "sortOrder": {
          "type": "integer"
        },
        "ownerId": {
          "type": "string"
        },
        "scope": {
          "type": "string"
        },
        "viewType": {
          "type": "string"
        },
        "filters": {
          "$ref": "#/$defs/JsonValue"
        },
        "sorts": {
          "$ref": "#/$defs/JsonValue"
        },
        "isPinned": {
          "type": "boolean"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "createdAt",
        "updatedAt",
        "sortOrder",
        "ownerId",
        "scope",
        "viewType",
        "filters",
        "sorts",
        "isPinned"
      ],
      "additionalProperties": false
    },
    "T451": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "ownerId": {
          "type": "string"
        },
        "scope": {
          "type": "string"
        },
        "projectId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "viewType": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "filters": {
          "$ref": "#/$defs/JsonValue"
        },
        "sorts": {
          "$ref": "#/$defs/JsonValue"
        },
        "isPinned": {
          "type": "boolean"
        },
        "sortOrder": {
          "type": "integer"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "ownerId",
        "scope",
        "projectId",
        "viewType",
        "name",
        "filters",
        "sorts",
        "isPinned",
        "sortOrder",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T452": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T453": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T454": {
      "type": "object",
      "properties": {
        "dashboards": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T205"
          }
        }
      },
      "required": [
        "dashboards"
      ],
      "additionalProperties": false
    },
    "T455": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T456": {
      "type": "object",
      "properties": {
        "widgets": {
          "type": "array",
          "items": {
            "$ref": "#/$defs/T207"
          }
        }
      },
      "required": [
        "widgets"
      ],
      "additionalProperties": false
    },
    "T457": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T458": {
      "type": "object",
      "properties": {
        "data": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T193"
            },
            {
              "$ref": "#/$defs/T196"
            },
            {
              "$ref": "#/$defs/T213"
            },
            {
              "$ref": "#/$defs/T214"
            },
            {
              "$ref": "#/$defs/T216"
            },
            {
              "$ref": "#/$defs/T219"
            },
            {
              "$ref": "#/$defs/T222"
            }
          ]
        }
      },
      "required": [
        "data"
      ],
      "additionalProperties": false
    },
    "T459": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T460": {
      "type": "object",
      "properties": {
        "sequence": {
          "type": "number"
        },
        "duplicate": {
          "type": "boolean"
        },
        "stateVectorHash": {
          "type": "string"
        }
      },
      "required": [
        "sequence",
        "duplicate",
        "stateVectorHash"
      ],
      "additionalProperties": false
    },
    "T461": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T462"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T462": {
      "type": "object",
      "properties": {
        "page": {
          "$ref": "#/$defs/T463"
        },
        "sequence": {
          "type": "number"
        },
        "publishedRevisionId": {
          "type": "string"
        },
        "indexing": {
          "anyOf": [
            {
              "$ref": "#/$defs/T464"
            },
            {
              "$ref": "#/$defs/T465"
            },
            {
              "$ref": "#/$defs/T466"
            }
          ]
        }
      },
      "required": [
        "page",
        "sequence",
        "publishedRevisionId",
        "indexing"
      ],
      "additionalProperties": false
    },
    "T463": {
      "type": "object",
      "properties": {
        "content": {
          "type": "string"
        },
        "revisionNo": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "slug": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "kind": {
          "type": "string"
        },
        "structureVersion": {
          "type": "integer"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "visibility": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "searchVector": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "currentRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "content",
        "revisionNo",
        "id",
        "projectId",
        "title",
        "slug",
        "parentId",
        "kind",
        "structureVersion",
        "createdBy",
        "archivedAt",
        "visibility",
        "sortOrder",
        "searchVector",
        "currentRevisionId",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T464": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "SUCCEEDED"
        },
        "jobId": {
          "type": "string"
        },
        "generation": {
          "type": "number"
        },
        "embedded": {
          "type": "number"
        }
      },
      "required": [
        "status",
        "jobId",
        "generation",
        "embedded"
      ],
      "additionalProperties": false
    },
    "T465": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "FAILED"
        },
        "message": {
          "type": "string"
        }
      },
      "required": [
        "status",
        "message"
      ],
      "additionalProperties": false
    },
    "T466": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "const": "QUEUED"
        }
      },
      "required": [
        "status"
      ],
      "additionalProperties": false
    },
    "T467": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T8"
            }
          ]
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T468": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T8"
            }
          ]
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T469": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T19"
        }
      },
      "required": [
        "replayed"
      ],
      "additionalProperties": false
    },
    "T470": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "targetId": {
          "type": "string"
        },
        "sourceId": {
          "type": "string"
        }
      },
      "required": [
        "type",
        "projectId",
        "id",
        "createdAt",
        "targetId",
        "sourceId"
      ],
      "additionalProperties": false
    },
    "T471": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "targetType": {
          "type": "string"
        },
        "targetId": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "editedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "targetType",
        "targetId",
        "authorId",
        "body",
        "parentId",
        "editedAt",
        "deletedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T472": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        }
      },
      "required": [
        "ok"
      ],
      "additionalProperties": false
    },
    "T473": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T158"
        }
      },
      "required": [
        "replayed"
      ],
      "additionalProperties": false
    },
    "T474": {
      "type": "object",
      "properties": {
        "ideaId": {
          "type": "string"
        },
        "weight": {
          "type": "number"
        },
        "score": {
          "type": "string"
        }
      },
      "required": [
        "ideaId",
        "weight",
        "score"
      ],
      "additionalProperties": false
    },
    "T475": {
      "type": "object",
      "properties": {
        "workItem": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T8"
            }
          ]
        },
        "alreadyPromoted": {
          "type": "boolean"
        }
      },
      "required": [
        "workItem",
        "alreadyPromoted"
      ],
      "additionalProperties": false
    },
    "T476": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T477"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T477": {
      "type": "object",
      "properties": {
        "currentRevisionId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "revisionNo": {
          "type": "integer"
        },
        "kind": {
          "type": "string"
        },
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "deletedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "slug": {
          "type": "string"
        },
        "structureVersion": {
          "type": "integer"
        },
        "visibility": {
          "type": "string"
        },
        "searchVector": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "currentRevisionId",
        "revisionNo",
        "kind",
        "projectId",
        "id",
        "title",
        "createdAt",
        "updatedAt",
        "parentId",
        "sortOrder",
        "archivedAt",
        "createdBy",
        "deletedAt",
        "slug",
        "structureVersion",
        "visibility",
        "searchVector"
      ],
      "additionalProperties": false
    },
    "T478": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "$ref": "#/$defs/T479"
            },
            {
              "$ref": "#/$defs/T282"
            },
            {
              "$ref": "#/$defs/T480"
            },
            {
              "$ref": "#/$defs/T481"
            }
          ]
        }
      },
      "required": [
        "replayed"
      ],
      "additionalProperties": false
    },
    "T479": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "startDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "endDate": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
        },
        "completionResult": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T265"
            }
          ]
        },
        "carryOver": {
          "type": "boolean"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "startDate",
        "completedAt",
        "endDate",
        "completionResult",
        "carryOver"
      ],
      "additionalProperties": false
    },
    "T480": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "parentId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "leadMemberId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "parentId",
        "sortOrder",
        "archivedAt",
        "leadMemberId"
      ],
      "additionalProperties": false
    },
    "T481": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "sortOrder": {
          "type": "integer"
        },
        "archivedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "completedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "completionResult": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "$ref": "#/$defs/T265"
            }
          ]
        },
        "versionTag": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "releaseDate": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
            }
          ]
        },
        "notes": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "sortOrder",
        "archivedAt",
        "completedAt",
        "completionResult",
        "versionTag",
        "releaseDate",
        "notes"
      ],
      "additionalProperties": false
    },
    "T482": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "scope": {
          "type": "string"
        },
        "id": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "ok",
        "scope",
        "id"
      ],
      "additionalProperties": false
    },
    "T483": {
      "type": "object",
      "properties": {
        "ok": {
          "type": "boolean"
        },
        "scope": {
          "type": "string"
        }
      },
      "required": [
        "ok",
        "scope"
      ],
      "additionalProperties": false
    },
    "T484": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T485"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T485": {
      "type": "object",
      "properties": {
        "deliveredCount": {
          "type": "integer"
        },
        "targetCount": {
          "type": "integer"
        },
        "failedCount": {
          "type": "integer"
        },
        "id": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "revokedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "severity": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "audience": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "deliveredCount",
        "targetCount",
        "failedCount",
        "id",
        "title",
        "createdAt",
        "revokedAt",
        "severity",
        "authorId",
        "body",
        "audience"
      ],
      "additionalProperties": false
    },
    "T486": {
      "type": "object",
      "properties": {
        "alreadyRevoked": {
          "type": "boolean"
        },
        "id": {
          "type": "string"
        },
        "authorId": {
          "type": "string"
        },
        "title": {
          "type": "string"
        },
        "body": {
          "type": "string"
        },
        "severity": {
          "type": "string"
        },
        "audience": {
          "$ref": "#/$defs/JsonValue"
        },
        "deliveredCount": {
          "type": "integer"
        },
        "revokedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "alreadyRevoked",
        "id",
        "authorId",
        "title",
        "body",
        "severity",
        "audience",
        "deliveredCount",
        "revokedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T487": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T488"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T488": {
      "type": "object",
      "properties": {
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "policyId": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "startedAt": {
          "type": "string",
          "format": "date-time"
        },
        "firstResponseAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "responseDueAt": {
          "type": "string",
          "format": "date-time"
        },
        "resolveDueAt": {
          "type": "string",
          "format": "date-time"
        },
        "breachedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "state": {
          "type": "string"
        },
        "pausedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "pausedMs": {
          "type": "integer"
        },
        "lastEscalatedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "id",
        "workItemId",
        "policyId",
        "startedAt",
        "firstResponseAt",
        "responseDueAt",
        "resolveDueAt",
        "breachedAt",
        "state",
        "pausedAt",
        "pausedMs",
        "lastEscalatedAt",
        "createdAt",
        "updatedAt"
      ],
      "additionalProperties": false
    },
    "T489": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "anyOf": [
            {
              "$ref": "#/$defs/T490"
            },
            {
              "$ref": "#/$defs/T491"
            }
          ]
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T490": {
      "type": "object",
      "properties": {
        "workItemId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "requestedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "transitionFields": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "status": {
          "type": "string"
        },
        "comment": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "workItemId",
        "id",
        "workflowId",
        "fromStateId",
        "toStateId",
        "requestedBy",
        "approverRoleKeys",
        "transitionFields",
        "status",
        "comment",
        "decidedBy",
        "decidedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T491": {
      "type": "object",
      "properties": {
        "workItem": {
          "$ref": "#/$defs/T8"
        },
        "id": {
          "type": "string"
        },
        "workItemId": {
          "type": "string"
        },
        "workflowId": {
          "type": "string"
        },
        "fromStateId": {
          "type": "string"
        },
        "toStateId": {
          "type": "string"
        },
        "requestedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "approverRoleKeys": {
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "transitionFields": {
          "type": "object",
          "additionalProperties": {
            "$ref": "#/$defs/JsonValue"
          }
        },
        "status": {
          "type": "string"
        },
        "comment": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "decidedAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        }
      },
      "required": [
        "workItem",
        "id",
        "workItemId",
        "workflowId",
        "fromStateId",
        "toStateId",
        "requestedBy",
        "approverRoleKeys",
        "transitionFields",
        "status",
        "comment",
        "decidedBy",
        "decidedAt",
        "createdAt"
      ],
      "additionalProperties": false
    },
    "T492": {
      "type": "object",
      "properties": {
        "replayed": {
          "type": "boolean"
        },
        "result": {
          "$ref": "#/$defs/T493"
        }
      },
      "required": [
        "replayed",
        "result"
      ],
      "additionalProperties": false
    },
    "T493": {
      "type": "object",
      "properties": {
        "projectId": {
          "type": "string"
        },
        "id": {
          "type": "string"
        },
        "name": {
          "type": "string"
        },
        "createdAt": {
          "type": "string",
          "format": "date-time"
        },
        "updatedAt": {
          "type": "string",
          "format": "date-time"
        },
        "actions": {
          "$ref": "#/$defs/JsonValue"
        },
        "createdBy": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "enabled": {
          "type": "boolean"
        },
        "trigger": {
          "type": "string"
        },
        "conditions": {
          "$ref": "#/$defs/JsonValue"
        },
        "scheduleCron": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "scheduleTimezone": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string"
            }
          ]
        },
        "lastScheduledAt": {
          "anyOf": [
            {
              "type": "null"
            },
            {
              "type": "string",
              "format": "date-time"
            }
          ]
        },
        "scheduleState": {
          "$ref": "#/$defs/JsonValue"
        }
      },
      "required": [
        "projectId",
        "id",
        "name",
        "createdAt",
        "updatedAt",
        "actions",
        "createdBy",
        "enabled",
        "trigger",
        "conditions",
        "scheduleCron",
        "scheduleTimezone",
        "lastScheduledAt",
        "scheduleState"
      ],
      "additionalProperties": false
    }
  },
  "sources": {
    "workitem.delete": "src/server/application/capabilities/legacy/work-planning-tools.ts:182",
    "workitem.listProgress": "src/server/application/capabilities/collaboration-tools.ts:36",
    "workitem.addProgress": "src/server/application/capabilities/collaboration-tools.ts:37",
    "workitem.deleteProgress": "src/server/application/capabilities/collaboration-tools.ts:38",
    "workitem.listTransfers": "src/server/application/capabilities/collaboration-tools.ts:39",
    "workitem.transfer": "src/server/application/capabilities/legacy/work-planning-tools.ts:205",
    "workitem.listCollaborators": "src/server/application/capabilities/collaboration-tools.ts:41",
    "workitem.addCollaborator": "src/server/application/capabilities/legacy/collaboration-tools.ts:76",
    "workitem.removeCollaborator": "src/server/application/capabilities/legacy/collaboration-tools.ts:85",
    "workitem.listWatchers": "src/server/application/capabilities/collaboration-tools.ts:44",
    "workitem.follow": "src/server/application/capabilities/legacy/collaboration-tools.ts:27",
    "workitem.unfollow": "src/server/application/capabilities/legacy/collaboration-tools.ts:110",
    "comment.list": "src/server/application/capabilities/collaboration-tools.ts:47",
    "comment.create": "src/server/application/capabilities/collaboration-tools.ts:48",
    "customField.getValues": "src/server/application/capabilities/compatibility-tools.ts:30",
    "customField.setValues": "src/server/application/capabilities/compatibility-tools.ts:31",
    "projectTemplate.list": "src/server/application/capabilities/legacy/project-tools.ts:306",
    "projectTemplate.get": "src/server/application/capabilities/legacy/project-tools.ts:314",
    "projectTemplate.create": "src/server/application/capabilities/legacy/project-tools.ts:322",
    "projectTemplate.update": "src/server/application/capabilities/legacy/project-tools.ts:334",
    "projectTemplate.delete": "src/server/application/capabilities/legacy/project-tools.ts:347",
    "project.createFromTemplate": "src/server/application/capabilities/configuration-tools.ts:27",
    "workflow.list": "src/server/application/capabilities/legacy/operations-tools.ts:34",
    "workflow.create": "src/server/application/capabilities/legacy/operations-tools.ts:35",
    "workflow.update": "src/server/application/capabilities/legacy/operations-tools.ts:36",
    "workflow.listStates": "src/server/application/capabilities/configuration-tools.ts:31",
    "workflow.addState": "src/server/application/capabilities/legacy/operations-tools.ts:38",
    "workflow.updateState": "src/server/application/capabilities/legacy/operations-tools.ts:39",
    "workflow.archiveState": "src/server/application/capabilities/legacy/operations-tools.ts:40",
    "workflow.listTransitions": "src/server/application/capabilities/configuration-tools.ts:35",
    "workflow.addTransition": "src/server/application/capabilities/legacy/operations-tools.ts:42",
    "workflow.updateTransition": "src/server/application/capabilities/legacy/operations-tools.ts:43",
    "workflow.removeTransition": "src/server/application/capabilities/legacy/operations-tools.ts:44",
    "page.revisions": "src/server/application/capabilities/legacy/content-tools.ts:227",
    "page.getRevision": "src/server/application/capabilities/content-tools.ts:55",
    "page.getPermissions": "src/server/application/capabilities/content-tools.ts:65",
    "import.list": "src/server/application/capabilities/legacy/operations-tools.ts:52",
    "import.get": "src/server/application/capabilities/legacy/operations-tools.ts:62",
    "import.suggestions": "src/server/application/capabilities/legacy/operations-tools.ts:74",
    "export.workItems": "src/server/application/capabilities/content-tools.ts:98",
    "export.projectReport": "src/server/application/capabilities/content-tools.ts:103",
    "delivery.sources": "src/server/application/capabilities/delivery-tools.ts:89",
    "delivery.configureSource": "src/server/application/capabilities/delivery-tools.ts:99",
    "delivery.listEvidence": "src/server/application/capabilities/delivery-tools.ts:113",
    "delivery.getEvidence": "src/server/application/capabilities/delivery-tools.ts:121",
    "delivery.createEvidence": "src/server/application/capabilities/delivery-tools.ts:133",
    "delivery.linkEvidence": "src/server/application/capabilities/delivery-tools.ts:149",
    "meta.capabilities": "src/server/application/capabilities/intelligence-tools.ts:29",
    "meta.tool": "src/server/application/capabilities/intelligence-tools.ts:45",
    "project.context": "src/server/application/capabilities/intelligence-tools.ts:50",
    "role.permissions": "src/server/application/capabilities/legacy/administration-tools.ts:17",
    "role.create": "src/server/application/capabilities/organization-tools.ts:112",
    "role.update": "src/server/application/capabilities/organization-tools.ts:114",
    "role.delete": "src/server/application/capabilities/organization-tools.ts:116",
    "role.scopeOptions": "src/server/application/capabilities/legacy/administration-tools.ts:21",
    "role.assignments": "src/server/application/capabilities/legacy/administration-tools.ts:22",
    "role.getAssignment": "src/server/application/capabilities/legacy/administration-tools.ts:23",
    "role.assign": "src/server/application/capabilities/legacy/administration-tools.ts:24",
    "role.updateAssignment": "src/server/application/capabilities/organization-tools.ts:121",
    "role.revoke": "src/server/application/capabilities/legacy/administration-tools.ts:26",
    "organization.departments": "src/server/application/capabilities/legacy/administration-tools.ts:27",
    "organization.createDepartment": "src/server/application/capabilities/legacy/administration-tools.ts:28",
    "organization.updateDepartment": "src/server/application/capabilities/legacy/administration-tools.ts:29",
    "organization.archiveDepartment": "src/server/application/capabilities/legacy/administration-tools.ts:30",
    "organization.positions": "src/server/application/capabilities/legacy/administration-tools.ts:31",
    "organization.createPosition": "src/server/application/capabilities/legacy/administration-tools.ts:32",
    "organization.updatePosition": "src/server/application/capabilities/legacy/administration-tools.ts:33",
    "organization.archivePosition": "src/server/application/capabilities/legacy/administration-tools.ts:34",
    "organization.assignMember": "src/server/application/capabilities/legacy/administration-tools.ts:35",
    "organization.applyTemplate": "src/server/application/capabilities/organization-tools.ts:73",
    "team.list": "src/server/application/capabilities/organization-tools.ts:91",
    "team.members": "src/server/application/capabilities/organization-tools.ts:92",
    "team.create": "src/server/application/capabilities/organization-tools.ts:94",
    "team.update": "src/server/application/capabilities/organization-tools.ts:96",
    "team.delete": "src/server/application/capabilities/organization-tools.ts:98",
    "timeLog.update": "src/server/application/capabilities/legacy/collaboration-tools.ts:51",
    "workitem.collaborators": "src/server/application/capabilities/legacy/collaboration-tools.ts:64",
    "workitem.watchers": "src/server/application/capabilities/legacy/collaboration-tools.ts:100",
    "timeLog.list": "src/server/application/capabilities/legacy/collaboration-tools.ts:118",
    "timeLog.create": "src/server/application/capabilities/legacy/collaboration-tools.ts:127",
    "timeLog.delete": "src/server/application/capabilities/legacy/collaboration-tools.ts:136",
    "workitem.contentLinks": "src/server/application/capabilities/legacy/collaboration-tools.ts:144",
    "workitem.createContentLink": "src/server/application/capabilities/legacy/collaboration-tools.ts:153",
    "workitem.deleteContentLink": "src/server/application/capabilities/legacy/collaboration-tools.ts:161",
    "prefs.get": "src/server/application/capabilities/legacy/collaboration-tools.ts:169",
    "prefs.update": "src/server/application/capabilities/legacy/collaboration-tools.ts:182",
    "sla.listPolicies": "src/server/application/capabilities/legacy/content-tools.ts:118",
    "sla.createPolicy": "src/server/application/capabilities/legacy/content-tools.ts:131",
    "sla.updatePolicy": "src/server/application/capabilities/legacy/content-tools.ts:150",
    "sla.deletePolicy": "src/server/application/capabilities/legacy/content-tools.ts:165",
    "idea.list": "src/server/application/capabilities/legacy/content-tools.ts:183",
    "idea.get": "src/server/application/capabilities/legacy/content-tools.ts:191",
    "idea.update": "src/server/application/capabilities/legacy/content-tools.ts:203",
    "idea.unvote": "src/server/application/capabilities/legacy/content-tools.ts:212",
    "idea.delete": "src/server/application/capabilities/legacy/content-tools.ts:220",
    "page.restore": "src/server/application/capabilities/legacy/content-tools.ts:238",
    "page.delete": "src/server/application/capabilities/legacy/content-tools.ts:249",
    "page.permissions": "src/server/application/capabilities/legacy/content-tools.ts:257",
    "page.setPermissions": "src/server/application/capabilities/legacy/content-tools.ts:271",
    "attachment.download": "src/server/application/capabilities/legacy/content-tools.ts:285",
    "attachment.remove": "src/server/application/capabilities/legacy/content-tools.ts:294",
    "attachment.get": "src/server/application/capabilities/legacy/content-tools.ts:302",
    "automation.updateRule": "src/server/application/capabilities/legacy/content-tools.ts:313",
    "automation.deleteRule": "src/server/application/capabilities/legacy/content-tools.ts:327",
    "automation.testRule": "src/server/application/capabilities/legacy/content-tools.ts:336",
    "notification.getPrefs": "src/server/application/capabilities/legacy/content-tools.ts:350",
    "announcement.list": "src/server/application/capabilities/legacy/content-tools.ts:358",
    "intake.listForms": "src/server/application/capabilities/workspace-tools.ts:213",
    "intake.getForm": "src/server/application/capabilities/legacy/content-tools.ts:381",
    "intake.createForm": "src/server/application/capabilities/workspace-tools.ts:214",
    "intake.updateForm": "src/server/application/capabilities/workspace-tools.ts:215",
    "intake.deleteForm": "src/server/application/capabilities/workspace-tools.ts:217",
    "intake.listSubmissions": "src/server/application/capabilities/workspace-tools.ts:218",
    "intake.convertSubmission": "src/server/application/capabilities/workspace-tools.ts:219",
    "intake.rejectSubmission": "src/server/application/capabilities/workspace-tools.ts:220",
    "workflow.states": "src/server/application/capabilities/legacy/operations-tools.ts:37",
    "workflow.transitions": "src/server/application/capabilities/legacy/operations-tools.ts:41",
    "import.create": "src/server/application/capabilities/legacy/operations-tools.ts:46",
    "import.setMapping": "src/server/application/capabilities/legacy/operations-tools.ts:75",
    "import.dryRun": "src/server/application/capabilities/legacy/operations-tools.ts:76",
    "import.confirm": "src/server/application/capabilities/legacy/operations-tools.ts:77",
    "import.rollback": "src/server/application/capabilities/legacy/operations-tools.ts:78",
    "workbench.get": "src/server/application/capabilities/legacy/operations-tools.ts:80",
    "todo.list": "src/server/application/capabilities/workspace-tools.ts:222",
    "todo.create": "src/server/application/capabilities/workspace-tools.ts:223",
    "todo.update": "src/server/application/capabilities/workspace-tools.ts:224",
    "todo.delete": "src/server/application/capabilities/workspace-tools.ts:225",
    "focus.blocks": "src/server/application/capabilities/legacy/operations-tools.ts:85",
    "focus.getBlock": "src/server/application/capabilities/legacy/operations-tools.ts:86",
    "focus.getSession": "src/server/application/capabilities/legacy/operations-tools.ts:87",
    "focus.createBlock": "src/server/application/capabilities/workspace-tools.ts:228",
    "focus.updateBlock": "src/server/application/capabilities/workspace-tools.ts:229",
    "focus.deleteBlock": "src/server/application/capabilities/workspace-tools.ts:236",
    "focus.sessions": "src/server/application/capabilities/legacy/operations-tools.ts:95",
    "focus.recordSession": "src/server/application/capabilities/workspace-tools.ts:239",
    "focus.updateSession": "src/server/application/capabilities/workspace-tools.ts:240",
    "focus.today": "src/server/application/capabilities/workspace-tools.ts:237",
    "project.create": "src/server/application/capabilities/legacy/project-tools.ts:200",
    "project.update": "src/server/application/capabilities/legacy/project-tools.ts:214",
    "project.archive": "src/server/application/capabilities/legacy/project-tools.ts:226",
    "project.unarchive": "src/server/application/capabilities/legacy/project-tools.ts:234",
    "project.status": "src/server/application/capabilities/legacy/project-tools.ts:241",
    "project.member.add": "src/server/application/capabilities/legacy/project-tools.ts:264",
    "project.member.remove": "src/server/application/capabilities/legacy/project-tools.ts:275",
    "member.list": "src/server/application/capabilities/legacy/project-tools.ts:290",
    "role.list": "src/server/application/capabilities/organization-tools.ts:108",
    "projectTemplate.createProject": "src/server/application/capabilities/legacy/project-tools.ts:360",
    "insight.burnDown": "src/server/application/capabilities/legacy/project-tools.ts:372",
    "insight.cumulativeFlow": "src/server/application/capabilities/workspace-tools.ts:291",
    "insight.projectActivity": "src/server/application/capabilities/legacy/project-tools.ts:400",
    "dashboard.list": "src/server/application/capabilities/workspace-tools.ts:259",
    "dashboard.get": "src/server/application/capabilities/workspace-tools.ts:263",
    "dashboard.create": "src/server/application/capabilities/workspace-tools.ts:268",
    "dashboard.update": "src/server/application/capabilities/workspace-tools.ts:269",
    "dashboard.delete": "src/server/application/capabilities/workspace-tools.ts:270",
    "dashboard.widgets.list": "src/server/application/capabilities/legacy/project-tools.ts:473",
    "dashboard.widgets.create": "src/server/application/capabilities/legacy/project-tools.ts:493",
    "dashboard.widgets.update": "src/server/application/capabilities/legacy/project-tools.ts:513",
    "dashboard.widgets.delete": "src/server/application/capabilities/legacy/project-tools.ts:527",
    "dashboard.widgets.data": "src/server/application/capabilities/legacy/project-tools.ts:543",
    "portfolio.list": "src/server/application/capabilities/workspace-tools.ts:205",
    "portfolio.get": "src/server/application/capabilities/workspace-tools.ts:206",
    "portfolio.create": "src/server/application/capabilities/workspace-tools.ts:208",
    "portfolio.update": "src/server/application/capabilities/workspace-tools.ts:209",
    "portfolio.delete": "src/server/application/capabilities/workspace-tools.ts:210",
    "portfolio.addProject": "src/server/application/capabilities/legacy/project-tools.ts:608",
    "portfolio.removeProject": "src/server/application/capabilities/legacy/project-tools.ts:617",
    "portfolio.summary": "src/server/application/capabilities/workspace-tools.ts:207",
    "customField.definitions": "src/server/application/capabilities/legacy/project-tools.ts:641",
    "customField.create": "src/server/application/capabilities/legacy/project-tools.ts:657",
    "customField.update": "src/server/application/capabilities/legacy/project-tools.ts:669",
    "customField.archive": "src/server/application/capabilities/legacy/project-tools.ts:682",
    "project.report": "src/server/application/capabilities/legacy/project-tools.ts:697",
    "project.exportCsv": "src/server/application/capabilities/legacy/project-tools.ts:723",
    "integration.list": "src/server/application/capabilities/legacy/project-tools.ts:736",
    "integration.create": "src/server/application/capabilities/legacy/project-tools.ts:752",
    "integration.update": "src/server/application/capabilities/legacy/project-tools.ts:763",
    "integration.delete": "src/server/application/capabilities/legacy/project-tools.ts:776",
    "integration.syncStatus": "src/server/application/capabilities/legacy/project-tools.ts:789",
    "integration.sync": "src/server/application/capabilities/legacy/project-tools.ts:801",
    "webhook.list": "src/server/application/capabilities/legacy/project-tools.ts:813",
    "webhook.create": "src/server/application/capabilities/legacy/project-tools.ts:827",
    "webhook.update": "src/server/application/capabilities/legacy/project-tools.ts:839",
    "webhook.delete": "src/server/application/capabilities/legacy/project-tools.ts:852",
    "webhook.deliveries": "src/server/application/capabilities/legacy/project-tools.ts:871",
    "webhook.replay": "src/server/application/capabilities/legacy/project-tools.ts:885",
    "plan.completeIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:160",
    "plan.completeRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:163",
    "workitem.children": "src/server/application/capabilities/legacy/work-planning-tools.ts:174",
    "workitem.transfers": "src/server/application/capabilities/legacy/work-planning-tools.ts:192",
    "workitem.relations": "src/server/application/capabilities/legacy/work-planning-tools.ts:222",
    "workitem.unlink": "src/server/application/capabilities/legacy/work-planning-tools.ts:230",
    "plan.listModules": "src/server/application/capabilities/legacy/work-planning-tools.ts:247",
    "plan.iterationCapacity": "src/server/application/capabilities/legacy/work-planning-tools.ts:258",
    "plan.setIterationCapacity": "src/server/application/capabilities/legacy/work-planning-tools.ts:273",
    "savedView.get": "src/server/application/capabilities/workspace-tools.ts:247",
    "savedView.delete": "src/server/application/capabilities/workspace-tools.ts:256",
    "savedView.reorder": "src/server/application/capabilities/workspace-tools.ts:257",
    "workitem.progressUpdates": "src/server/application/capabilities/legacy/work-planning-tools.ts:342",
    "workitem.addProgressUpdate": "src/server/application/capabilities/legacy/work-planning-tools.ts:355",
    "workitem.deleteProgressUpdate": "src/server/application/capabilities/legacy/work-planning-tools.ts:368",
    "plan.milestoneDetail": "src/server/application/capabilities/legacy/work-planning-tools.ts:384",
    "plan.milestoneProgressUpdates": "src/server/application/capabilities/legacy/work-planning-tools.ts:393",
    "plan.addMilestoneProgressUpdate": "src/server/application/capabilities/legacy/work-planning-tools.ts:405",
    "plan.deleteMilestoneProgressUpdate": "src/server/application/capabilities/legacy/work-planning-tools.ts:418",
    "organization.get": "src/server/application/capabilities/organization-tools.ts:67",
    "organization.update": "src/server/application/capabilities/organization-tools.ts:69",
    "organization.getTemplate": "src/server/application/capabilities/organization-tools.ts:71",
    "department.list": "src/server/application/capabilities/organization-tools.ts:75",
    "department.create": "src/server/application/capabilities/organization-tools.ts:77",
    "department.update": "src/server/application/capabilities/organization-tools.ts:79",
    "department.archive": "src/server/application/capabilities/organization-tools.ts:81",
    "position.list": "src/server/application/capabilities/organization-tools.ts:83",
    "position.create": "src/server/application/capabilities/organization-tools.ts:85",
    "position.update": "src/server/application/capabilities/organization-tools.ts:87",
    "position.archive": "src/server/application/capabilities/organization-tools.ts:89",
    "member.get": "src/server/application/capabilities/organization-tools.ts:100",
    "member.getPermissions": "src/server/application/capabilities/organization-tools.ts:101",
    "member.assignOrganization": "src/server/application/capabilities/organization-tools.ts:103",
    "member.disable": "src/server/application/capabilities/organization-tools.ts:104",
    "member.enable": "src/server/application/capabilities/organization-tools.ts:105",
    "member.anonymize": "src/server/application/capabilities/organization-tools.ts:106",
    "role.listPermissions": "src/server/application/capabilities/organization-tools.ts:109",
    "role.listScopes": "src/server/application/capabilities/organization-tools.ts:110",
    "role.listAssignments": "src/server/application/capabilities/organization-tools.ts:117",
    "role.createAssignment": "src/server/application/capabilities/organization-tools.ts:119",
    "role.deleteAssignment": "src/server/application/capabilities/organization-tools.ts:123",
    "product.list": "src/server/application/capabilities/product-tools.ts:19",
    "product.get": "src/server/application/capabilities/product-tools.ts:21",
    "product.create": "src/server/application/capabilities/product-tools.ts:23",
    "product.update": "src/server/application/capabilities/product-tools.ts:33",
    "product.linkProject": "src/server/application/capabilities/product-tools.ts:35",
    "product.unlinkProject": "src/server/application/capabilities/product-tools.ts:37",
    "rag.conversation.propose": "src/server/application/capabilities/rag-conversation-tools.ts:22",
    "rag.conversation.revise": "src/server/application/capabilities/rag-conversation-tools.ts:23",
    "rag.conversation.execution": "src/server/application/capabilities/rag-conversation-tools.ts:24",
    "rag.conversation.action": "src/server/application/capabilities/rag-conversation-tools.ts:25",
    "rag.conversation.list": "src/server/application/capabilities/rag-conversation-tools.ts:26",
    "rag.conversation.get": "src/server/application/capabilities/rag-conversation-tools.ts:27",
    "rag.conversation.create": "src/server/application/capabilities/rag-conversation-tools.ts:28",
    "rag.conversation.update": "src/server/application/capabilities/rag-conversation-tools.ts:29",
    "rag.conversation.send": "src/server/application/capabilities/rag-conversation-tools.ts:30",
    "rag.conversation.cancel": "src/server/application/capabilities/rag-conversation-tools.ts:31",
    "rag.projects": "src/server/application/capabilities/rag-tools.ts:15",
    "rag.search": "src/server/application/capabilities/rag-tools.ts:16",
    "rag.chat": "src/server/application/capabilities/rag-tools.ts:17",
    "delivery.releaseGate": "src/server/application/capabilities/release-gate-tools.ts:78",
    "delivery.createCandidate": "src/server/application/capabilities/release-gate-tools.ts:86",
    "delivery.recordFeedback": "src/server/application/capabilities/release-gate-tools.ts:101",
    "requirementChange.context": "src/server/application/capabilities/requirement-change-tools.ts:32",
    "requirementChange.list": "src/server/application/capabilities/requirement-change-tools.ts:39",
    "requirementChange.get": "src/server/application/capabilities/requirement-change-tools.ts:53",
    "requirementChange.create": "src/server/application/capabilities/requirement-change-tools.ts:69",
    "requirementChange.decide": "src/server/application/capabilities/requirement-change-tools.ts:95",
    "requirementChange.apply": "src/server/application/capabilities/requirement-change-tools.ts:110",
    "requirementChange.acknowledge": "src/server/application/capabilities/requirement-change-tools.ts:125",
    "testPlan.list": "src/server/application/capabilities/test-execution-tools.ts:83",
    "testPlan.get": "src/server/application/capabilities/test-execution-tools.ts:93",
    "testPlan.report": "src/server/application/capabilities/test-execution-tools.ts:101",
    "testRun.get": "src/server/application/capabilities/test-execution-tools.ts:113",
    "testPlan.create": "src/server/application/capabilities/test-execution-tools.ts:121",
    "testPlan.update": "src/server/application/capabilities/test-execution-tools.ts:131",
    "testPlan.transition": "src/server/application/capabilities/test-execution-tools.ts:146",
    "testRun.start": "src/server/application/capabilities/test-execution-tools.ts:161",
    "testRun.record": "src/server/application/capabilities/test-execution-tools.ts:176",
    "testRun.complete": "src/server/application/capabilities/test-execution-tools.ts:191",
    "testRun.createDefect": "src/server/application/capabilities/test-execution-tools.ts:206",
    "testRun.linkDefect": "src/server/application/capabilities/test-execution-tools.ts:221",
    "testSuite.list": "src/server/application/capabilities/test-management-tools.ts:40",
    "testSuite.get": "src/server/application/capabilities/test-management-tools.ts:52",
    "testSuite.create": "src/server/application/capabilities/test-management-tools.ts:60",
    "testSuite.update": "src/server/application/capabilities/test-management-tools.ts:86",
    "testCase.list": "src/server/application/capabilities/test-management-tools.ts:101",
    "testCase.get": "src/server/application/capabilities/test-management-tools.ts:111",
    "testCase.revisions": "src/server/application/capabilities/test-management-tools.ts:119",
    "testCase.getRevision": "src/server/application/capabilities/test-management-tools.ts:134",
    "testCase.create": "src/server/application/capabilities/test-management-tools.ts:147",
    "testCase.update": "src/server/application/capabilities/test-management-tools.ts:173",
    "ping": "src/server/application/capabilities/tools.ts:109",
    "collab.inspect": "src/server/application/capabilities/tools.ts:120",
    "whoami": "src/server/application/capabilities/tools.ts:152",
    "project.list": "src/server/application/capabilities/tools.ts:176",
    "project.get": "src/server/application/capabilities/tools.ts:189",
    "project.members": "src/server/application/capabilities/tools.ts:200",
    "workitem.list": "src/server/application/capabilities/tools.ts:225",
    "workitem.get": "src/server/application/capabilities/tools.ts:247",
    "workitem.comments": "src/server/application/capabilities/tools.ts:262",
    "plan.listMilestones": "src/server/application/capabilities/tools.ts:279",
    "plan.getMilestone": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-milestone",
    "plan.listIterations": "src/server/application/capabilities/tools.ts:310",
    "plan.listReleases": "src/server/application/capabilities/tools.ts:321",
    "notification.list": "src/server/application/capabilities/tools.ts:332",
    "activity.project": "src/server/application/capabilities/tools.ts:352",
    "meta.workflow": "src/server/application/capabilities/tools.ts:369",
    "page.list": "src/server/application/capabilities/tools.ts:380",
    "page.get": "src/server/application/capabilities/tools.ts:391",
    "knowledge.search": "src/server/application/capabilities/tools.ts:407",
    "knowledge.ask": "src/server/application/capabilities/tools.ts:423",
    "meta.fields": "src/server/application/capabilities/tools.ts:434",
    "sla.get": "src/server/application/capabilities/tools.ts:441",
    "approval.list": "src/server/application/capabilities/tools.ts:452",
    "automation.listRules": "src/server/application/capabilities/tools.ts:463",
    "automation.listRuns": "src/server/application/capabilities/tools.ts:473",
    "intake.rotateToken": "src/server/application/capabilities/workspace-tools.ts:216",
    "focus.listBlocks": "src/server/application/capabilities/workspace-tools.ts:227",
    "focus.listSessions": "src/server/application/capabilities/workspace-tools.ts:238",
    "savedView.list": "src/server/application/capabilities/workspace-tools.ts:242",
    "savedView.create": "src/server/application/capabilities/workspace-tools.ts:248",
    "savedView.update": "src/server/application/capabilities/workspace-tools.ts:252",
    "dashboard.listWidgets": "src/server/application/capabilities/workspace-tools.ts:271",
    "dashboard.addWidget": "src/server/application/capabilities/workspace-tools.ts:276",
    "dashboard.updateWidget": "src/server/application/capabilities/workspace-tools.ts:280",
    "dashboard.deleteWidget": "src/server/application/capabilities/workspace-tools.ts:285",
    "dashboard.widgetData": "src/server/application/capabilities/workspace-tools.ts:286",
    "insight.burndown": "src/server/application/capabilities/workspace-tools.ts:290",
    "insight.activitySeries": "src/server/application/capabilities/workspace-tools.ts:292",
    "collab.command": "src/server/application/capabilities/write-tools.ts:88",
    "collab.update": "src/server/application/capabilities/write-tools.ts:123",
    "collab.publishPage": "src/server/application/capabilities/write-tools.ts:145",
    "workitem.create": "src/server/application/capabilities/write-tools.ts:173",
    "workitem.update": "src/server/application/capabilities/write-tools.ts:197",
    "workitem.transition": "src/server/application/capabilities/write-tools.ts:218",
    "workitem.assign": "src/server/application/capabilities/write-tools.ts:237",
    "workitem.comment": "src/server/application/capabilities/write-tools.ts:255",
    "workitem.link": "src/server/application/capabilities/write-tools.ts:277",
    "comment.update": "src/server/application/capabilities/write-tools.ts:289",
    "comment.delete": "src/server/application/capabilities/write-tools.ts:296",
    "idea.submit": "src/server/application/capabilities/write-tools.ts:311",
    "idea.vote": "src/server/application/capabilities/write-tools.ts:328",
    "idea.promote": "src/server/application/capabilities/write-tools.ts:344",
    "page.create": "src/server/application/capabilities/write-tools.ts:365",
    "page.update": "src/server/application/capabilities/write-tools.ts:382",
    "plan.createMilestone": "src/server/application/capabilities/write-tools.ts:417",
    "plan.createIteration": "src/server/application/capabilities/write-tools.ts:436",
    "plan.createRelease": "src/server/application/capabilities/write-tools.ts:452",
    "plan.createModule": "src/server/application/capabilities/write-tools.ts:468",
    "notification.markRead": "src/server/application/capabilities/write-tools.ts:487",
    "notification.setPrefs": "src/server/application/capabilities/write-tools.ts:516",
    "announcement.send": "src/server/application/capabilities/write-tools.ts:556",
    "announcement.revoke": "src/server/application/capabilities/write-tools.ts:568",
    "sla.pause": "src/server/application/capabilities/write-tools.ts:575",
    "sla.resume": "src/server/application/capabilities/write-tools.ts:586",
    "approval.approve": "src/server/application/capabilities/write-tools.ts:597",
    "approval.reject": "src/server/application/capabilities/write-tools.ts:608",
    "automation.createRule": "src/server/application/capabilities/write-tools.ts:619",
    "plan.updateMilestone": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-milestone",
    "plan.archiveMilestone": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-milestone",
    "plan.unarchiveMilestone": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-milestone",
    "plan.getIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-iteration",
    "plan.updateIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-iteration",
    "plan.archiveIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-iteration",
    "plan.unarchiveIteration": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-iteration",
    "plan.getRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-release",
    "plan.updateRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-release",
    "plan.archiveRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-release",
    "plan.unarchiveRelease": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-release",
    "plan.getModule": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-module",
    "plan.updateModule": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-module",
    "plan.archiveModule": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-module",
    "plan.unarchiveModule": "src/server/application/capabilities/legacy/work-planning-tools.ts:dynamic-module"
  }
};
