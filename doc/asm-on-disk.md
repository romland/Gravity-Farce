There was some assembly source code on the disk. No idea if this was on the golden master or not. I don't recall seeing it "way back then" at least and I am pretty sure I probably poked around then too! Funny either way.

This was the source:
```
1,0,0,0
dc.l 1000
dc.b 2,8,9,9,0,0
dc.b 0,0,1,0,0,0
dc.l 1000
weapontab:
dc.b 2,5,0,0,0,0
dc.w 150
dc.b 3,0,0,0,0,0
dc.w 100
dc.b 2,5,0,0,0,0
dc.w 100
dc.b 2,5,0,0,0,0
dc.w 100
gamecon: 
 tst.b gamepos
 bne gcase2
 move.b #2,blend
 move.b #0,blendstep
 move.b #01,gamepos
 rts 
gcase2:
 cmp.b #2,gamepos
 beq gameexit
 cmp.b #3,gamepos
 beq exitlevel
 cmp.b #4,gamepos
 beq exitgame
 cmp.b #5,gamepos
 beq waitexlevel
 cmp.b #6,gamepos
 beq showord
 cmp.b #07,gamepos
 beq showord2
 cmp.b #08,gamepos
 beq gcon8
 tst.b llost
 bne liveminus
 cmp.b #3,status0
 bne.s gconend
 tst.b boxes
 bne.s gconend
 cmp.l #cargobay,cargop
 bne.s gconend
gamecomplete:
 move.b #05,gamepos
 move.b #01,manual
cmp.b #49,level
beq gfcomplete
 move.b #1,mesnr
 move.b #70,mestime
 move.b #90,gametimer
gconend: rts
gfcomplete:
move.l #planebas+24234-42,map0line
printm #planebas+20,#720,#lastmes,#05,#planelen 
printm #planebas+05,#736,#lastmes1,#2,#planelen
add.w #500,score
move.b #01,scoreout
jsr printscore
move.l #100000,d0
edelay: dbra d0,edelay
jsr click
jmp init
gameexit: 
 sub.b #01,gametimer
 beq.s startexit
 rts
startexit:
tst.b boxes
bne sexgon
cmp.b #49,level
beq gfcomplete
jsr searchword
cmp.b #6,gamepos
beq endlevel
sexgon:
 move.b #1,blend
 move.b #$0f,blendstep
 move.b #04,gamepos
 rts
exitgame:
 tst.b blend
 bne unrts
 jmp init
unrts:  rts
endlevel:
clr.b blend
move.b #7,gamepos
showord2:
move.b #255,mestime
btst #7,$bfe001
bne unrts
 move.b #1,blend
 move.b #$0f,blendstep
 move.b #04,gamepos
 rts
waitexlevel:
sub.b #01,gametimer
bne.s unrts
move.b #03,gamepos
move.b #1,blend
move.b #$0f,blendstep
jmp searchword
un1rts: rts
exitlevel:
 tst.b blend
 bne un1rts
add.b #01,level
move.b level,d0
move.w #$4000,intenaw
jsr loadlevel
jmp initG 
searchword:
lea wordtab,a0
move.b level,d0
add.b #01,d0
swloop:
cmp.b (a0),d0
bne swnext
 move.b #04,mesnr
 move.b #255,mestime
 move.l 2(a0),mesword
 move.l 6(a0),mesword+4
 move.b #06,gamepos
 clr.b blend
swnext:
add.l #10,a0
cmp.l #wordend,a0
bne swloop
showord:
move.b #255,mestime
btst #07,$bfe001
bne unrts
move.b #03,gamepos
move.b #01,blend
move.b #$0f,blendstep
gamepos: dc.b 0
diepos: dc.b 0
gametimer: dc.b 0,0
liveminus:
tst.b diepos
bne waitdarkl
move.b #0,weapon
jsr loadweapon
move.l #99999,fuel
subq.b #01,lives
bpl.s notgover
 move.b #100,gametimer
 move.b #02,gamepos
 move.b #2,mesnr
 move.b #90,mestime
 rts
notgover:
tst.b boxes
bne ngoon
```