// TriggerCard.js
import BaseCard from "./BaseCard.js";
import BaseSocket from "./BaseSocket.js";
import { useCanvases } from "../composables/useCanvases.js";
import {
  initializeCardData,
  useCardSetup,
  setupCardDataWatchers,
  setupSocketWatcher,
} from "../utils/cardManagement/cardUtils.js";
import { createSocket } from "../utils/socketManagement/socketRemapping.js";

export default {
  name: "TriggerCard",
  components: { BaseCard, BaseSocket },
  props: {
    cardData: { type: Object, required: true },
    zoomLevel: { type: Number, default: 1 },
    zIndex: { type: Number, default: 1 },
    isSelected: { type: Boolean, default: false },
  },

  template: `
    <div class="card">
      <BaseCard
        :card-data="localCardData"
        :zoom-level="zoomLevel"
        :z-index="zIndex"
        :is-selected="isSelected"
        @drag-start="$emit('drag-start', $event)"   
        @drag="$emit('drag', $event)"
        @drag-end="$emit('drag-end', $event)"
        @update-card="handleCardUpdate"
        @close-card="$emit('close-card', $event)"
        @clone-card="uuid => $emit('clone-card', uuid)"
        @select-card="$emit('select-card', $event)"
      >
        <!-- Input Socket -->
        <div class="absolute -left-[12px]" style="top: 16px;">
          <BaseSocket
            v-if="localCardData.data.sockets.inputs[0]"
            type="input"
            :socket-id="localCardData.data.sockets.inputs[0].id"
            :card-id="localCardData.uuid"
            :name="localCardData.data.sockets.inputs[0].name || 'Input'"
            :value="localCardData.data.sockets.inputs[0].value"
            :is-connected="getSocketConnections(localCardData.data.sockets.inputs[0].id)"
            :has-error="hasSocketError(localCardData.data.sockets.inputs[0].id)"
            :zoom-level="zoomLevel"
            @connection-drag-start="$emit('connection-drag-start', $event)"
            @connection-drag="$emit('connection-drag', $event)"
            @connection-drag-end="$emit('connection-drag-end', $event)"
            @socket-mounted="handleSocketMount($event)"
          />
        </div>

        <!-- Output Socket (only shown when no sequence) -->
        <div 
          v-if="!hasSequence && localCardData.data.sockets.outputs?.[0]"
          class="absolute -right-[12px]" 
          style="top: 16px;"
        >
          <BaseSocket
            type="output"
            :socket-id="localCardData.data.sockets.outputs[0].id"
            :card-id="localCardData.uuid"
            :name="localCardData.data.sockets.outputs[0].name || 'Output'"
            :value="localCardData.data.sockets.outputs[0].value"
            :is-connected="getSocketConnections(localCardData.data.sockets.outputs[0].id)"
            :has-error="hasSocketError(localCardData.data.sockets.outputs[0].id)"
            :zoom-level="zoomLevel"
            @connection-drag-start="$emit('connection-drag-start', $event)"
            @connection-drag="$emit('connection-drag', $event)"
            @connection-drag-end="$emit('connection-drag-end', $event)"
            @socket-mounted="handleSocketMount($event)"
          />
        </div>

        <!-- Content -->
        <div class="space-y-4 text-gray-300" v-show="localCardData.ui.display === 'default'">
          <!-- Trigger Button -->
          <div class="flex justify-center mt-2">
            <button 
              class="px-6 py-2 text-sm font-medium rounded"
              :class="isRunning ? 'bg-orange-500 hover:bg-orange-600' : 'bg-green-500 hover:bg-green-600'"
              @click="handleTriggerClick"
              @mousedown.stop
            >
              {{ isRunning ? 'Stop' : 'Trigger' }}
            </button>
          </div>

          <!-- Sequence Section -->
          <div class="mt-4">
            <div class="flex justify-between items-center mb-2">
              <label class="text-xs font-medium text-gray-400">Sequence:</label>
              <button 
                class="px-2 py-1 text-xs bg-blue-500 hover:bg-blue-600 text-white rounded"
                @click="addSequenceItem"
                @mousedown.stop
              >+ Add</button>
            </div>
            
            <div class="space-y-2">
              <div 
                v-for="(item, index) in localCardData.data.sequence" 
                :key="item.id"
                class="flex items-center gap-2 p-2 rounded relative transition-all duration-200"
                :class="{
                  'bg-gray-900': getCardStatus(item.cardId) === 'idle',
                  'bg-yellow-500/80 animate-pulse': getCardStatus(item.cardId) === 'inProgress',
                  'bg-green-500/80': getCardStatus(item.cardId) === 'complete',
                  'border border-red-500': item.errorCount > 0
                }"
              >
                <span class="text-xs text-gray-400 w-6">{{ index + 1 }}.</span>
                <select
                  v-model="item.cardId"
                  class="flex-1 bg-gray-800 text-xs text-gray-200 px-2 py-1 rounded cursor-pointer"
                  :class="{'border-red-500': item.errorCount > 0}"
                  @mousedown.stop
                  @change="handleCardUpdate"
                >
                  <option value="">Select card...</option>
                  <option 
                    v-for="card in availableCards" 
                    :key="card.uuid" 
                    :value="card.uuid"
                  >
                    {{ card.ui.name }}
                  </option>
                </select>

                <span 
                  v-if="item.errorCount > 0" 
                  class="text-xs text-red-500 ml-2"
                >
                  Retry {{item.errorCount}}/3
                </span>

                <button 
                  class="text-gray-400 hover:text-gray-200 ml-2"
                  @click="removeSequenceItem(index)"
                  @mousedown.stop
                  @touchstart.stop
                >×</button>
              </div>
            </div>
          </div>
        </div>
      </BaseCard>
    </div>
  `,

  setup(props, { emit }) {
    const { activeCards, activeConnections, removeConnection } = useCanvases();

    // Initialize card setup utilities
    const {
      socketRegistry,
      connections,
      isProcessing,
      getSocketConnections,
      handleSocketMount,
      cleanup,
    } = useCardSetup(props, emit);

    // Initialize state
    const isRunning = Vue.ref(false);
    const currentSequenceIndex = Vue.ref(-1);
    const retryTimeout = Vue.ref(null);
    const isTransitioning = Vue.ref(false);

    // Initialize local card data with proper defaults
    const localCardData = Vue.ref(
      initializeCardData(props.cardData, {
        defaultName: "Trigger",
        defaultDescription: "Trigger Node",
        defaultWidth: 300,
        defaultData: {
          sequence: props.cardData.data?.sequence || [],
          status: "idle",
        },
        defaultSockets: {
          inputs: [{ name: "Trigger Input" }],
          outputs: [{ name: "Trigger Output" }],
        },
      })
    );

    // Computed properties
    const hasSequence = Vue.computed(
      () => (localCardData.value.data?.sequence || []).length > 0
    );

    // Remove output socket if sequence exists
    if (hasSequence.value) {
      localCardData.value.data.sockets.outputs = [];
    }

    const availableCards = Vue.computed(() =>
      activeCards.value.filter(
        (card) =>
          card.uuid !== localCardData.value.uuid &&
          (card.type === "agent" || card.type === "web")
      )
    );

    // Setup socket watcher
    setupSocketWatcher({
      props,
      localCardData,
      isProcessing,
      emit,
      onInputChange: (change) => {
        if (change.type === "modified" && change.newValue !== null) {
          handleInputTrigger();
        }
      },
    });

    // Watch for card data changes
    const watchers = setupCardDataWatchers({
      props,
      localCardData,
      isProcessing,
      emit,
    });

    // Watch position changes
    Vue.watch(
      () => ({ x: props.cardData.ui?.x, y: props.cardData.ui?.y }),
      watchers.position
    );

    // Watch display changes
    Vue.watch(() => props.cardData.ui?.display, watchers.display);

    //Watch for width changes
    Vue.watch(() => props.cardData.ui?.width, watchers.width);

    // Watch for status changes
    Vue.watch(
      () =>
        activeCards.value.map((card) => ({
          id: card.uuid,
          status: card.status,
        })),
      () => {
        if (
          isRunning.value &&
          hasSequence.value &&
          currentSequenceIndex.value >= 0 &&
          !isTransitioning.value
        ) {
          handleCardStatusChange();
        }
      },
      { deep: true }
    );

    // Emit initial state
    Vue.onMounted(() => {
      console.log("TriggerCard mounted, emitting initial state");
      Vue.nextTick(() => {
        handleCardUpdate();
      });
    });

    // Cleanup
    Vue.onUnmounted(() => {
      if (retryTimeout.value) {
        clearTimeout(retryTimeout.value);
      }
      cleanup();
    });

    //----------------------------------------
    // Card Specific Functions
    //----------------------------------------

    const handleCardUpdate = () => {
      if (!isProcessing.value) {
        emit("update-card", Vue.toRaw(localCardData.value));
      }
    };

    const triggerCard = (cardId) => {
      const card = activeCards.value.find((c) => c.uuid === cardId);
      if (card) {
        emit("update-card", {
          ...Vue.toRaw(card),
          trigger: Date.now(),
        });
      }
    };

    const handleDirectTrigger = () => {
      updateOutputSocketValue();

      const connections = activeConnections.value.filter(
        (conn) => conn.sourceCardId === localCardData.value.uuid
      );

      connections.forEach((conn) => {
        const targetCard = activeCards.value.find(
          (card) => card.uuid === conn.targetCardId
        );
        if (
          targetCard &&
          (targetCard.type === "agent" || targetCard.type === "web")
        ) {
          triggerCard(targetCard.uuid);
        }
      });
    };

    const handleInputTrigger = () => {
      if (hasSequence.value) {
        isRunning.value = true;
        processSequence();
      } else {
        handleDirectTrigger();
      }
    };

    const addSequenceItem = () => {
      if (
        localCardData.value.data.sequence.length === 0 &&
        localCardData.value.data.sockets.outputs?.[0]
      ) {
        const outputSocketId = localCardData.value.data.sockets.outputs[0].id;
        const existingConnections = activeConnections.value.filter(
          (conn) =>
            conn.sourceCardId === localCardData.value.uuid &&
            conn.sourceSocketId === outputSocketId
        );

        existingConnections.forEach((conn) => {
          removeConnection(conn.id);
        });
      }

      localCardData.value.data.sequence.push({
        id: `seq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        cardId: "",
        errorCount: 0,
      });

      if (localCardData.value.data.sequence.length === 1) {
        localCardData.value.data.sockets.outputs = [];
      }

      handleCardUpdate();
    };

    const removeSequenceItem = (index) => {
      localCardData.value.data.sequence.splice(index, 1);

      if (localCardData.value.data.sequence.length === 0) {
        localCardData.value.data.sockets.outputs = [
          createSocket({
            type: "output",
            name: "Trigger Output",
          }),
        ];
      }

      handleCardUpdate();
    };

    const findNextValidSequenceItem = (currentIndex) => {
      for (
        let i = currentIndex + 1;
        i < localCardData.value.data.sequence.length;
        i++
      ) {
        const item = localCardData.value.data.sequence[i];
        if (item.cardId && item.cardId.trim() !== "") {
          const cardExists = activeCards.value.some(
            (card) => card.uuid === item.cardId
          );
          if (cardExists) {
            return i;
          }
        }
      }
      return -1;
    };

    const updateOutputSocketValue = () => {
      if (!hasSequence.value && localCardData.value.data.sockets.outputs?.[0]) {
        localCardData.value.data.sockets.outputs[0].value = Date.now();
        handleCardUpdate();
      }
    };

    const completeSequence = () => {
      if (retryTimeout.value) {
        clearTimeout(retryTimeout.value);
        retryTimeout.value = null;
      }

      isRunning.value = false;
      currentSequenceIndex.value = -1;
      isTransitioning.value = false;

      localCardData.value.data.sequence.forEach((item) => {
        item.errorCount = 0;
        const card = activeCards.value.find((c) => c.uuid === item.cardId);
        if (card && card.status !== "idle") {
          emit("update-card", {
            ...Vue.toRaw(card),
            status: "idle",
            trigger: null,
          });
        }
      });

      if (localCardData.value.data.sockets.outputs?.[0]) {
        localCardData.value.data.sockets.outputs[0].value = null;
      }

      handleCardUpdate();
    };

    const processSequence = () => {
      if (isTransitioning.value) return;
      isTransitioning.value = true;

      // Reset all items' error counts
      localCardData.value.data.sequence.forEach((item) => {
        item.errorCount = 0;
      });

      // Clear any existing timeouts
      if (retryTimeout.value) {
        clearTimeout(retryTimeout.value);
        retryTimeout.value = null;
      }

      // Find first valid item to start with
      let startIndex = -1;
      for (let i = 0; i < localCardData.value.data.sequence.length; i++) {
        const item = localCardData.value.data.sequence[i];
        if (item.cardId && item.cardId.trim() !== "") {
          const cardExists = activeCards.value.some(
            (card) => card.uuid === item.cardId
          );
          if (cardExists) {
            startIndex = i;
            break;
          }
        }
      }

      // If no valid items found, complete the sequence
      if (startIndex === -1) {
        completeSequence();
        return;
      }

      // Reset valid cards that need it
      const validCardIds = new Set(
        localCardData.value.data.sequence
          .filter((item) => {
            if (!item.cardId || item.cardId.trim() === "") return false;
            return activeCards.value.some((card) => card.uuid === item.cardId);
          })
          .map((item) => item.cardId)
      );

      activeCards.value
        .filter((card) => validCardIds.has(card.uuid) && card.status !== "idle")
        .forEach((card) => {
          emit("update-card", {
            ...Vue.toRaw(card),
            status: "idle",
            trigger: null,
          });
        });

      // Start sequence execution
      currentSequenceIndex.value = startIndex;
      const firstCardId = localCardData.value.data.sequence[startIndex].cardId;
      const cardToTrigger = activeCards.value.find(
        (c) => c.uuid === firstCardId
      );

      if (cardToTrigger) {
        triggerCard(firstCardId);
      } else {
        const nextIndex = findNextValidSequenceItem(currentSequenceIndex.value);
        if (nextIndex !== -1) {
          currentSequenceIndex.value = nextIndex;
          triggerCard(localCardData.value.data.sequence[nextIndex].cardId);
        } else {
          completeSequence();
        }
      }

      setTimeout(() => {
        isTransitioning.value = false;
      }, 100);
    };

    const retryCard = (cardId, sequenceIndex) => {
      const sequenceItem = localCardData.value.data.sequence[sequenceIndex];
      if (sequenceItem.errorCount < 3) {
        if (retryTimeout.value) {
          clearTimeout(retryTimeout.value);
          retryTimeout.value = null;
        }

        sequenceItem.errorCount++;
        handleCardUpdate();

        retryTimeout.value = setTimeout(() => {
          if (isRunning.value) {
            triggerCard(cardId);
          }
          retryTimeout.value = null;
        }, 5000);
      } else {
        const nextIndex = currentSequenceIndex.value + 1;
        if (nextIndex < localCardData.value.data.sequence.length) {
          currentSequenceIndex.value = nextIndex;
          triggerCard(localCardData.value.data.sequence[nextIndex].cardId);
        } else {
          completeSequence();
        }
      }
    };

    const handleCardStatusChange = () => {
      const currentItem =
        localCardData.value.data.sequence[currentSequenceIndex.value];
      const currentCard = activeCards.value.find(
        (card) => card.uuid === currentItem?.cardId
      );

      // Handle card not existing anymore
      if (!currentCard) {
        const nextIndex = findNextValidSequenceItem(currentSequenceIndex.value);
        if (nextIndex !== -1) {
          isTransitioning.value = true;
          currentSequenceIndex.value = nextIndex;
          triggerCard(localCardData.value.data.sequence[nextIndex].cardId);
          setTimeout(() => {
            isTransitioning.value = false;
          }, 100);
        } else {
          completeSequence();
        }
        return;
      }

      // Handle normal status transitions
      if (currentCard.status === "complete") {
        const nextIndex = findNextValidSequenceItem(currentSequenceIndex.value);
        if (nextIndex !== -1) {
          isTransitioning.value = true;
          currentSequenceIndex.value = nextIndex;
          triggerCard(localCardData.value.data.sequence[nextIndex].cardId);
          setTimeout(() => {
            isTransitioning.value = false;
          }, 100);
        } else {
          completeSequence();
        }
      }
    };

    const handleTriggerClick = () => {
      if (isRunning.value) {
        completeSequence();
        return;
      }

      if (hasSequence.value) {
        isRunning.value = true;
        processSequence();
      } else {
        handleDirectTrigger();
      }
    };

    const getCardStatus = (cardId) => {
      if (!cardId || cardId.trim() === "") return "idle";
      const card = activeCards.value.find((c) => c.uuid === cardId);
      return card?.status || "idle";
    };

    const hasSocketError = () => false;

    return {
      localCardData,
      hasSequence,
      isRunning,
      availableCards,
      getSocketConnections,
      hasSocketError,
      handleSocketMount,
      handleCardUpdate,
      addSequenceItem,
      removeSequenceItem,
      handleTriggerClick,
      getCardStatus,
    };
  },
};
