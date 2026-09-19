dim lastBox as Array[String]
	dim pendingBox as Array[String]
	
	sub OnInit()
	    println "===== INIT TAGS ====="
	    dim i as Integer
	    for i = 1 to 8
	        lastBox.Push("")
	        pendingBox.Push("")
	    next
	    Stage.FindDirector("TAGS_1").ContinueAnimation()
	    Stage.FindDirector("TAGS_2").ContinueAnimation()
	    Stage.FindDirector("TAGS_3").ContinueAnimation()
	    Stage.FindDirector("TAGS_4").ContinueAnimation()
	    Stage.FindDirector("TAGS_5").ContinueAnimation()
	    Stage.FindDirector("TAGS_6").ContinueAnimation()
	    Stage.FindDirector("TAGS_7").ContinueAnimation()
	    Stage.FindDirector("TAGS_8").ContinueAnimation()
	end sub
	
	sub OnInitParameters()
	    dim i as Integer
	    RegisterPushButton("exec", "CHECK TAG", 0)
	    for i = 1 to 8
	        RegisterPushButton("apply" & CStr(i), "APPLY BOX " & CStr(i), i)
	        RegisterPushButton("reset" & CStr(i), "RESET TAG " & CStr(i), 10 + i)
	    next
	    RegisterParameterString("Tags", "Tags", "", 5, 500, "")
	end sub
	
	sub OnExecAction(buttonId as Integer)
	    if buttonId = 0 then
	        ApplyTagData(GetParameterString("Tags"))
	    elseif buttonId >= 1 and buttonId <= 8 then
	        ApplyPendingTag(pendingBox[buttonId - 1])
	    elseif buttonId >= 11 and buttonId <= 18 then
	        ResetTag(buttonId - 10)
	    end if
	end sub
	
	sub ResetTag(tagIndex as Integer)
	    println "RESET TAGS_" & CStr(tagIndex) & " TO SELECTION 7"
	    System.SendCommand("MAIN_SCENE*TREE*$TAGS_" & CStr(tagIndex) & "$FF_TAG_NAME$object*FUNCTION*ControlObject*in SET ON SelectType_Box_07 SET 7")
	end sub
	
	sub ApplyTagData(data as String)
	    dim layoutParts as Array[String]
	    dim entries as Array[String]
	    dim values as Array[String]
	    dim i as Integer
	    dim targetIndex as Integer
	    dim tagValue as String
	
	    data.Split("|", layoutParts)
	    if layoutParts.Size < 2 then
	        println "INVALID TAG DATA"
	        exit sub
	    end if
	
	    layoutParts[1].Split(",", entries)
	    println "================================"
	    println "===== CHECK TAG DATA ==========="
	    println "ENTRIES SIZE = " & CStr(entries.Size)
	
	    for i = 0 to entries.Size - 1
	        entries[i].Split(":", values)
	        if values.Size >= 4 then
	            ' BOX_01:0:0:Doha -> values[0]=BOX_01, values[1]=box index, values[2]=type, values[3]=location
	            targetIndex = CInt(values[1])
	            tagValue = values[2] & ":" & values[3]
	
	            println "-------------------------------"
	            println "ENTRY = " & entries[i]
	            println "TARGET = TAGS_" & CStr(targetIndex + 1)
	            println "TAG VALUE = " & tagValue
	
	            if lastBox[targetIndex] = "" then
	                println "TAGS_" & CStr(targetIndex + 1) & " FIRST LOAD"
	                pendingBox[targetIndex] = entries[i]
	                lastBox[targetIndex] = tagValue
	            elseif lastBox[targetIndex] <> tagValue then
	                println "TAGS_" & CStr(targetIndex + 1) & " CHANGED -> CONTINUE"
	                pendingBox[targetIndex] = entries[i]
	                Stage.FindDirector("TAGS_" & CStr(targetIndex + 1)).ContinueAnimation()
	                lastBox[targetIndex] = tagValue
	            else
	                println "TAGS_" & CStr(targetIndex + 1) & " SAME -> KEEP"
	                pendingBox[targetIndex] = entries[i]
	            end if
	        end if
	    next
	
	    println "===== LAST TAG ARRAY ====="
	    for i = 0 to lastBox.Size - 1
	        println "TAGS_" & CStr(i + 1) & " = " & lastBox[i]
	    next
	end sub
	
	sub ApplyPendingTag(data as String)
	    dim values as Array[String]
	    dim targetIndex as Integer
	    dim selectionType as String
	    dim location as String
	
	    if data = "" then
	        println "NO PENDING TAG"
	        exit sub
	    end if
	
	    data.Split(":", values)
	    if values.Size >= 4 then
	        targetIndex = CInt(values[1])
	        selectionType = values[2]
	        location = values[3]
	
	        println "===== APPLY PENDING TAG ====="
	        println "TARGET = TAGS_" & CStr(targetIndex + 1)
	        println "TYPE = " & selectionType
	        println "LOCATION = " & location
	
	        System.SendCommand("MAIN_SCENE*TREE*$TAGS_" & CStr(targetIndex + 1) & "$FF_TAG_NAME$object*FUNCTION*ControlObject*in SET ON Locator_07 SET " & location)
	        System.SendCommand("MAIN_SCENE*TREE*$TAGS_" & CStr(targetIndex + 1) & "$FF_TAG_NAME$object*FUNCTION*ControlObject*in SET ON SelectType_Box_07 SET " & selectionType)
	    end if
	end sub
	